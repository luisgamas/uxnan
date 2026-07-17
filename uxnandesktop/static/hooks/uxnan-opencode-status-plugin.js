// Uxnan Desktop - OpenCode status plugin.
//
// OpenCode loads this ES module from its `plugins/` dir (the ADE registers it in
// `~/.config/opencode/opencode.json`). It runs inside the OpenCode process and
// reports the agent's lifecycle to the ADE's local hook server, so the sidebar
// shows a precise state. The ADE injects the coordinates
// (UXNAN_HOOK_URL / UXNAN_HOOK_TOKEN / UXNAN_AGENT_ID) into the terminal env, and
// also UXNAN_ENDPOINT_FILE — a file it rewrites every launch with the live
// coordinates, which we prefer so a session that outlived a restart still reports.
//
// OpenCode's plugin API: an exported async factory that returns an object of
// hooks; we use the `event` hook and re-label OpenCode's native bus events to the
// small synthetic vocabulary the hook server normalizes (SessionBusy / SessionIdle
// / MessagePart / PermissionRequest / AskUserQuestion / Error). Fail-open — a
// dead server never blocks the agent.
//
// Sub-agents: OpenCode runs a delegated sub-agent (the `task` tool) as a **child
// session** — a `session.created` whose `properties.info.parentID` points at the
// parent. Its later events carry the child's `properties.sessionID`. We report a
// child's lifecycle as SubagentStart / SubagentStop (keyed by the child session
// id, named from its title `"… (@<name> subagent)"`) and, crucially, we do NOT let
// a child session's busy/idle flip the PARENT's status (that used to read the
// parent as done the moment a background child finished). Validated against
// OpenCode 1.17.20.
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

function coords() {
  const file = process.env.UXNAN_ENDPOINT_FILE
    ? readEndpointFile(process.env.UXNAN_ENDPOINT_FILE)
    : {};
  return {
    url: file.UXNAN_HOOK_URL || process.env.UXNAN_HOOK_URL || "",
    token: file.UXNAN_HOOK_TOKEN || process.env.UXNAN_HOOK_TOKEN || "",
    agentId: process.env.UXNAN_AGENT_ID || "",
  };
}

async function report(event, source) {
  const { url, token, agentId } = coords();
  if (!url || !agentId || !event) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Uxnan-Token": token,
      },
      body: JSON.stringify({ agentId, agentType: AGENT_TYPE, event, source: source || {} }),
    });
  } catch {
    // Fire-and-forget; never block the agent on a slow/dead hook server.
  }
}

/** The session id an event belongs to (`properties.sessionID`, or the id on a
 *  `session.created`). */
function sessionIdOf(props) {
  return props.sessionID || (props.info && props.info.id) || "";
}

/** Split a child session title `"say ready (@general subagent)"` into its task
 *  description and the sub-agent name. */
function parseChildTitle(title) {
  const m = /^(.*?)\s*\(@([^\s)]+)\s+subagent\)\s*$/.exec(title || "");
  if (m) return { description: m[1].trim() || undefined, agentType: m[2] };
  const t = (title || "").trim();
  return { description: t || undefined, agentType: undefined };
}

// Map an OpenCode bus event to a synthetic hook-server event name (+ optional
// enrichment). Returns null for events that aren't a state transition.
function classify(evt) {
  const type = evt && evt.type;
  const props = (evt && evt.properties) || {};
  const sid = sessionIdOf(props);

  // A prompt needs the user regardless of which session raised it.
  if (type === "permission.asked" || type === "permission.updated") {
    return { event: "PermissionRequest" };
  }
  if (type === "question.asked") return { event: "AskUserQuestion" };

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

  // Root / parent-session events.
  switch (type) {
    case "session.idle":
      return { event: "SessionIdle" };
    case "session.error":
      return { event: "Error", source: { error: String(props.error || props.message || "") } };
    case "session.status": {
      const s = (props.status && props.status.type) || props.status || "";
      if (s === "idle") return { event: "SessionIdle" };
      // busy / retry / anything active
      return { event: "SessionBusy" };
    }
    case "message.part.updated": {
      const part = props.part || {};
      const role = part.role || props.role;
      const text = typeof part.text === "string" ? part.text : undefined;
      return { event: "MessagePart", source: { role, text } };
    }
    default:
      return null;
  }
}

async function handleEvent(payload) {
  const evt = payload && payload.event ? payload.event : payload;
  const mapped = classify(evt);
  if (mapped) await report(mapped.event, mapped.source);
}

// OpenCode's plugin loader calls each exported async factory with a context and
// expects an object of hooks back. We register the `event` hook. A single named
// export (no default) so the plugin is loaded exactly once.
export const UxnanStatusPlugin = async () => ({
  event: handleEvent,
});
