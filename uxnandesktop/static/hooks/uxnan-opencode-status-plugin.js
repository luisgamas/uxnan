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
// Marker (do not remove — the ADE detects a managed install by this line):
// Uxnan Desktop - OpenCode status plugin

"use strict";

const AGENT_TYPE = "opencode";

let cached = null;
let cachedKey = "";

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

// Map an OpenCode bus event to a synthetic hook-server event name (+ optional
// enrichment). Returns null for events that aren't a state transition.
function classify(evt) {
  const type = evt && evt.type;
  const props = (evt && evt.properties) || {};
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
    case "permission.asked":
    case "permission.updated":
      return { event: "PermissionRequest" };
    case "question.asked":
      return { event: "AskUserQuestion" };
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
