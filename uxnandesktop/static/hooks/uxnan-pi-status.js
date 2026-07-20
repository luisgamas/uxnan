// Uxnan Desktop - Pi status extension.
//
// Pi (and OMP, which shares its API) has no JSON hook surface — it exposes an
// in-process extension API. The ADE installs this file into
// `~/.pi/agent/extensions/` and Pi loads it in its own process. It registers
// `pi.on(<event>)` handlers and reports each to the ADE's local hook server, so
// the sidebar shows a precise state. Coordinates come from the injected env
// (UXNAN_HOOK_URL / UXNAN_HOOK_TOKEN / UXNAN_AGENT_ID); because process.env is
// frozen when Pi spawns, we prefer UXNAN_ENDPOINT_FILE (rewritten every launch)
// so a session that outlived an app restart still reports.
//
// Fail-open: every hook is wrapped so a dead server never breaks the Pi run. Pi
// only ever reaches `working` / `done` (it has no permission/blocked signal).
//
// Marker (do not remove — the ADE detects a managed install by this line):
// Uxnan Desktop - Pi status extension

"use strict";

const AGENT_TYPE = "pi";

function readEndpointFile(path) {
  try {
    const text = require("fs").readFileSync(path, "utf8");
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
      const m = raw.match(/^(?:set\s+)?([A-Za-z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/\r$/, "");
    }
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

// Last session identity seen on any event payload (Pi resumes by session file:
// `pi --session <path|id>`). Extracted best-effort across the payload spellings
// Pi has used; rides every subsequent report so the ADE can offer the resume.
let lastSession = null;

function noteSession(e) {
  if (!e || typeof e !== "object") return;
  // Only EXPLICIT session spellings — a generic `.id` on a tool/message payload
  // must never be mistaken for a session id. `.id`/`.file`/`.path` are trusted
  // only nested under a dedicated `session` object.
  const nested = e.session && typeof e.session === "object" ? e.session : null;
  const id =
    e.session_id ||
    e.sessionId ||
    e.sessionID ||
    (nested && (nested.session_id || nested.sessionId || nested.sessionID || nested.id));
  const file =
    e.session_file ||
    e.sessionFile ||
    (nested && (nested.session_file || nested.sessionFile || nested.file || nested.path));
  if (typeof id === "string" && id) {
    lastSession = { session_id: id, session_file: typeof file === "string" ? file : undefined };
  } else if (typeof file === "string" && file) {
    lastSession = {
      session_id: lastSession ? lastSession.session_id : undefined,
      session_file: file,
    };
  }
}

function post(event, source) {
  const { url, token, agentId } = coords();
  if (!url || !agentId || !event) return;
  if (lastSession) {
    source = Object.assign({}, source, {
      session_id: lastSession.session_id,
      session_file: lastSession.session_file,
    });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  try {
    const transport = parsed.protocol === "https:" ? require("https") : require("http");
    const data = JSON.stringify({ agentId, agentType: AGENT_TYPE, event, source: source || {} });
    const req = transport.request(parsed, {
      method: "POST",
      timeout: 1500,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "X-Uxnan-Token": token,
      },
    });
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.end(data);
  } catch {
    // Fire-and-forget.
  }
}

/** Flatten an assistant message's content to plain text (text parts only). */
function assistantText(message) {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return typeof message.text === "string" ? message.text : "";
}

// (pi event name) → (server event name, extractor). The server maps each to
// working/done. Names mirror Pi's own event vocabulary.
const HANDLERS = {
  before_agent_start: (e) => post("before_agent_start", { prompt: (e && e.prompt) || "" }),
  agent_start: () => post("agent_start"),
  tool_execution_start: (e) =>
    post("tool_execution_start", { tool_name: e && (e.toolName || e.tool_name), tool_input: e && (e.args || e.input) }),
  tool_call: (e) =>
    post("tool_call", { tool_name: e && (e.toolName || e.tool_name), tool_input: e && (e.input || e.args) }),
  tool_execution_end: (e) => post("tool_execution_end", { tool_name: e && (e.toolName || e.tool_name) }),
  message_end: (e) => {
    const msg = e && e.message;
    if (!msg || msg.role !== "assistant") return;
    const text = assistantText(msg);
    if (text) post("message_end", { role: "assistant", text });
  },
  agent_end: () => post("agent_end"),
  session_shutdown: () => post("session_shutdown"),
};

/** Register every handler on the Pi extension API, ignoring events it doesn't offer. */
function register(pi) {
  if (!pi || typeof pi.on !== "function") return;
  // Session identity: sniff every payload we see, and also subscribe to the
  // session lifecycle events (when this Pi version offers them) whose whole
  // job is announcing the session file/id.
  for (const ev of ["session_start", "session_switched"]) {
    try {
      pi.on(ev, (payload) => {
        try {
          noteSession(payload);
        } catch {
          /* never break the agent */
        }
      });
    } catch {
      // Event not offered by this Pi version — skip it.
    }
  }
  for (const [event, handler] of Object.entries(HANDLERS)) {
    try {
      pi.on(event, (payload) => {
        try {
          noteSession(payload);
          handler(payload);
        } catch {
          /* never break the agent */
        }
      });
    } catch {
      // Event not offered by this Pi version — skip it.
    }
  }
}

// Pi's extension entry point varies; expose the common conventions. If Pi passes
// its API to a default export / `activate` / `setup`, we register there.
export default function (pi) {
  register(pi);
}
export function activate(pi) {
  register(pi);
}
export function setup(pi) {
  register(pi);
}
