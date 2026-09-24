// Uxnan Desktop - OpenCode status plugin.
//
// OpenCode loads this ES module from its `plugins/` dir, which it auto-discovers
// (no config entry). It runs inside the OpenCode server and reports the agent's
// lifecycle to the ADE's local hook server, so the sidebar shows a precise state.
// The ADE injects the coordinates (UXNAN_HOOK_URL / UXNAN_HOOK_TOKEN /
// UXNAN_AGENT_ID) into the terminal env, and also UXNAN_ENDPOINT_FILE — a file it
// rewrites every launch with the live coordinates, tried when the environment's
// server is gone, so a session that outlived a restart still reports.
//
// Every report is re-labelled to the small synthetic vocabulary the hook server
// normalizes (SessionBusy / SessionIdle / MessagePart / PermissionRequest /
// AskUserQuestion / Error / SubagentStart / SubagentStop). Fail-open — a dead
// server never blocks the agent.
//
// Two plugin APIs, one file. The default export is a descriptor carrying both:
//   * `server` — the V1 API: an async factory returning `{ event }`, handed the
//     bus events (`session.status`, `session.idle`, `message.part.updated`, …).
//     OpenCode 1.x, MiMo Code and Kilo Code call it; OpenCode 2 ignores it.
//   * `setup` — the V2 API: called with a context whose `event.subscribe()`
//     streams OpenCode 2's events (`session.execution.*`, `form.*`, …). V1 hosts
//     call it too, with no `event` on the context, so it does nothing there.
// Measured, not assumed: OpenCode 1.17.20 / 1.18.25 / 1.18.32 / 2.0.16, Kilo 7.7.9
// and MiMo 0.1.15 each load this shape once and report through exactly one of the
// two paths. (A bare named factory — the old shape — is rejected by OpenCode 2:
// "Plugin must export a default definition with an id and an effect or setup
// function".)
//
// OpenCode 2 runs plugins in a SERVER, not in the TUI. Launched by uxnan it runs
// `--standalone`: a private server, child of the TUI in the tab, with the tab's
// environment — so UXNAN_AGENT_ID names this tab. A bare `opencode` instead talks
// to the shared background service (`opencode serve --service`), whose
// environment is whichever terminal started it first; reporting from there would
// file every OpenCode tab's state under that one tab, so the plugin stays silent
// in the shared service.
//
// Sub-agents: OpenCode runs a delegated sub-agent (the `task` tool) as a **child
// session** — V1: a `session.created` whose `properties.info.parentID` points at
// the parent, titled `"… (@<name> subagent)"`; V2: `data.parentID`, with the
// sub-agent's name in `data.agent`. We report a child's lifecycle as
// SubagentStart / SubagentStop (keyed by the child session id) and, crucially, we
// do NOT let a child session's busy/idle flip the PARENT's status (that used to
// read the parent as done the moment a background child finished).
//
// Marker (do not remove — the ADE detects a managed install by this line):
// Uxnan Desktop - OpenCode status plugin

"use strict";

const AGENT_TYPE = "opencode";

let cached = null;
let cachedKey = "";
/** Session ids known to be sub-agent children (created with a parentID). */
const childSessions = new Set();

function readEndpointFile(path) {
  try {
    const fs = require("fs");
    const stat = fs.statSync(path);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (key === cachedKey && cached) return cached;
    const text = fs.readFileSync(path, "utf8");
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
      const m = raw.match(/^(?:set\s+)?([A-Za-z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/\r$/, "");
    }
    cached = out;
    cachedKey = key;
    return out;
  } catch {
    return {};
  }
}

// Where to report, in the order that survives more than one uxnan window.
//
// The terminal's own environment comes FIRST and the endpoint file is only the
// rescue. The file lives at one shared path, so a second uxnan window overwrites
// it with its own coordinates — and preferring it sent every agent of the first
// window's reports to the second one, which is why a second window showed no
// completion checks. The file still matters when the environment is stale (a
// session that outlived an app restart), so it is tried when the first POST
// fails.
function coordCandidates() {
  const out = [];
  const envUrl = process.env.UXNAN_HOOK_URL || "";
  if (envUrl) out.push({ url: envUrl, token: process.env.UXNAN_HOOK_TOKEN || "" });
  const file = process.env.UXNAN_ENDPOINT_FILE
    ? readEndpointFile(process.env.UXNAN_ENDPOINT_FILE)
    : {};
  if (file.UXNAN_HOOK_URL && file.UXNAN_HOOK_URL !== envUrl) {
    out.push({ url: file.UXNAN_HOOK_URL, token: file.UXNAN_HOOK_TOKEN || "" });
  }
  return out;
}

async function report(event, source) {
  const agentId = process.env.UXNAN_AGENT_ID || "";
  if (!agentId || !event) return;
  const body = JSON.stringify({ agentId, agentType: AGENT_TYPE, event, source: source || {} });
  for (const { url, token } of coordCandidates()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Uxnan-Token": token },
        body,
      });
      // 2xx only: a 401 from another window's server is a failed attempt, so the
      // next candidate still gets a turn.
      if (res.ok) return;
    } catch {
      // Fire-and-forget; never block the agent on a slow/dead hook server.
    }
  }
}

/** The session id an event belongs to (`properties.sessionID`, or the id on a
 *  `session.created`). */
function sessionIdOf(props) {
  return props.sessionID || (props.info && props.info.id) || "";
}

/** An error's readable text. Both APIs hand over an object — V1
 *  `{ name, data: { message } }`, V2 `{ type, message }` — which `String()`
 *  would turn into "[object Object]". */
function errorText(e) {
  if (!e) return "";
  if (typeof e === "string") return e;
  const data = e.data || {};
  return String(data.message || e.message || e.name || e.type || "");
}

/** Split a child session title `"say ready (@general subagent)"` into its task
 *  description and the sub-agent name. */
function parseChildTitle(title) {
  const m = /^(.*?)\s*\(@([^\s)]+)\s+subagent\)\s*$/.exec(title || "");
  if (m) return { description: m[1].trim() || undefined, agentType: m[2] };
  const t = (title || "").trim();
  return { description: t || undefined, agentType: undefined };
}

// Map a V1 bus event to a synthetic hook-server event name (+ optional
// enrichment). Returns null for events that aren't a state transition.
function classifyV1(evt) {
  const type = evt && evt.type;
  const props = (evt && evt.properties) || {};
  const sid = sessionIdOf(props);

  // The ROOT session's id rides every state event we report, so the ADE can
  // offer `opencode --session <id>` when this tab is restored or woken. A
  // child (sub-agent) session's id must never overwrite it.
  const rootSid = sid && !childSessions.has(sid) ? sid : "";

  // A prompt needs the user regardless of which session raised it.
  if (type === "permission.asked" || type === "permission.updated") {
    return { event: "PermissionRequest", source: rootSid ? { sessionID: rootSid } : undefined };
  }
  // …and an answered one puts the agent back to work. Kilo Code names this
  // event (OpenCode does not emit it), and without it a session that was
  // waiting would sit there until its next status event.
  if (type === "permission.replied") {
    return { event: "SessionBusy", source: rootSid ? { sessionID: rootSid } : undefined };
  }
  // Kilo Code's tool events. OpenCode reports tool use through `session.status`
  // instead, so this arm is simply never taken there.
  if (type === "tool.execute.before" || type === "tool.execute.after") {
    return {
      event: "SessionBusy",
      source: { sessionID: rootSid || undefined, tool_name: props.tool || props.name },
    };
  }
  if (type === "question.asked") {
    return { event: "AskUserQuestion", source: rootSid ? { sessionID: rootSid } : undefined };
  }

  // Sub-agent (child session) lifecycle. A child is created with a parentID; its
  // events must never flip the parent's status.
  if (type === "session.created") {
    const info = props.info || {};
    if (info.parentID) {
      childSessions.add(info.id);
      const { description, agentType } = parseChildTitle(info.title);
      return {
        event: "SubagentStart",
        source: { agent_id: info.id, agent_type: agentType, description },
      };
    }
    return null; // root session created — not a status transition
  }
  if (sid && childSessions.has(sid)) {
    if (type === "session.idle" || type === "session.error") {
      childSessions.delete(sid);
      return { event: "SubagentStop", source: { agent_id: sid } };
    }
    return null; // any other child-session event stays off the parent
  }

  // Root / parent-session events (each carries the root session id, above).
  switch (type) {
    case "session.idle":
      return { event: "SessionIdle", source: rootSid ? { sessionID: rootSid } : undefined };
    case "session.error":
      return {
        event: "Error",
        source: {
          error: errorText(props.error || props.message),
          sessionID: rootSid || undefined,
        },
      };
    case "session.status": {
      const s = (props.status && props.status.type) || props.status || "";
      const src = rootSid ? { sessionID: rootSid } : undefined;
      if (s === "idle") return { event: "SessionIdle", source: src };
      // busy / retry / anything active
      return { event: "SessionBusy", source: src };
    }
    case "message.part.updated": {
      const part = props.part || {};
      const role = part.role || props.role;
      const text = typeof part.text === "string" ? part.text : undefined;
      return { event: "MessagePart", source: { role, text, sessionID: rootSid || undefined } };
    }
    default:
      return null;
  }
}

/** The last reply text of each root session (V2), sent with its SessionIdle so
 *  the card can show what the agent answered. */
const lastReply = new Map();

// Map an OpenCode 2 event (`{ type, data: { sessionID, … } }`) to the same
// synthetic vocabulary. Every name and field here was read off a real OpenCode
// 2.0.16 run (a turn, a permission, a question, a sub-agent, an interruption).
function classifyV2(evt) {
  const type = evt && evt.type;
  const data = (evt && evt.data) || {};
  // A form carries its session inside the form itself.
  const sid = data.sessionID || (data.form && data.form.sessionID) || "";
  const isChild = !!sid && childSessions.has(sid);
  const src = (extra) => Object.assign({ sessionID: sid && !isChild ? sid : undefined }, extra);

  // Anything that needs the person, whichever session raised it.
  if (type === "permission.asked") return { event: "PermissionRequest", source: src() };
  if (type === "form.created") return { event: "AskUserQuestion", source: src() };
  // …and an answer puts the agent back to work.
  if (type === "permission.replied" || type === "form.replied" || type === "form.cancelled") {
    return { event: "SessionBusy", source: src() };
  }

  // Sub-agent (child session) lifecycle.
  if (type === "session.created") {
    if (!data.parentID) return null; // root session created — not a transition
    childSessions.add(sid);
    return {
      event: "SubagentStart",
      source: {
        agent_id: sid,
        agent_type: data.agent || undefined,
        description: (data.title || "").trim() || undefined,
      },
    };
  }
  if (isChild) {
    if (
      type === "session.execution.succeeded" ||
      type === "session.execution.failed" ||
      type === "session.execution.interrupted"
    ) {
      childSessions.delete(sid);
      return { event: "SubagentStop", source: { agent_id: sid } };
    }
    return null; // any other child-session event stays off the parent
  }

  switch (type) {
    case "session.execution.started":
    case "session.retry.scheduled":
      return { event: "SessionBusy", source: src() };
    case "session.inbox.enqueued": {
      const item = data.item || {};
      const text = item.type === "user" && item.payload && item.payload.text;
      return typeof text === "string" && text.trim()
        ? { event: "SessionBusy", source: src({ prompt: text }) }
        : null;
    }
    case "session.tool.input.started":
      return { event: "SessionBusy", source: src({ tool_name: data.name || undefined }) };
    case "session.text.ended":
      if (typeof data.text === "string" && data.text.trim()) lastReply.set(sid, data.text);
      return { event: "MessagePart", source: src({ role: "assistant", text: data.text }) };
    case "session.execution.succeeded":
    case "session.execution.interrupted": {
      const reply = lastReply.get(sid);
      lastReply.delete(sid);
      return {
        event: "SessionIdle",
        source: src({
          last_assistant_message: reply,
          interrupted: type === "session.execution.interrupted" || undefined,
        }),
      };
    }
    case "session.execution.failed": {
      lastReply.delete(sid);
      return { event: "Error", source: src({ error: errorText(data.error) }) };
    }
    default:
      return null;
  }
}

async function handleEvent(payload) {
  const evt = payload && payload.event ? payload.event : payload;
  const mapped = classifyV1(evt);
  if (mapped) await report(mapped.event, mapped.source);
}

// The V1 API: an async factory returning an object of hooks; we register `event`.
const UxnanStatusPlugin = async () => ({
  event: handleEvent,
});

/** Whether this process is OpenCode 2's shared background service rather than a
 *  server of one tab's own (see the header). */
function inSharedService() {
  return process.argv.includes("--service");
}

// The V2 API: `setup(ctx)`. Only OpenCode 2 hands it an event stream; a V1 host
// calls it with no `event` and it does nothing, since `server` reports there.
async function setup(ctx) {
  if (!ctx || !ctx.event || typeof ctx.event.subscribe !== "function") return;
  if (inSharedService()) return;
  const stream = ctx.event.subscribe();
  // Not awaited: setup must return for OpenCode to finish loading plugins.
  (async () => {
    try {
      for await (const evt of stream) {
        const mapped = classifyV2(evt);
        if (mapped) await report(mapped.event, mapped.source);
      }
    } catch {
      // The stream ends with the server; nothing to report then.
    }
  })();
}

// One default export, loaded exactly once by every host (see the header). Its
// `id` is how OpenCode 2 names the plugin in its status and diagnostics.
export default { id: "uxnan-status", setup, server: UxnanStatusPlugin };
