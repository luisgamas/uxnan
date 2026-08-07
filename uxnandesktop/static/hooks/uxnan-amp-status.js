// Uxnan Desktop - Amp status plugin.
//
// Amp loads this ES module from its `plugins/` dir (`~/.config/amp/plugins/`),
// which it auto-discovers — there is no config entry to merge, so nothing of the
// user's is ever rewritten. It runs inside the Amp process and reports the
// agent's lifecycle to the ADE's local hook server, so the sidebar shows a
// precise state. The ADE injects the coordinates (UXNAN_HOOK_URL /
// UXNAN_HOOK_TOKEN / UXNAN_AGENT_ID) into the terminal env, and also
// UXNAN_ENDPOINT_FILE — a file it rewrites every launch with the live
// coordinates, which we prefer so a session that outlived a restart still
// reports.
//
// Amp's plugin API is its own (not OpenCode's): the module default-exports a
// function that receives a `PluginAPI` and subscribes with `amp.on(name, fn)`.
// Its five events are `session.start`, `agent.start`, `agent.end`, `tool.call`
// and `tool.result`; the server maps them (`hooks::normalize_event`).
//
// `tool.call` is a GATING event — Amp uses its return value to allow or reject
// the tool — so this returns `{ action: "allow" }`. A reporter must never be the
// reason a tool didn't run; the same rule that makes the shell reporter answer
// `{}` for Cursor.
//
// Marker (do not remove — the ADE detects a managed install by this line):
// Uxnan Desktop - Amp status plugin

"use strict";

const AGENT_TYPE = "amp";

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
      headers: { "Content-Type": "application/json", "X-Uxnan-Token": token },
      body: JSON.stringify({ agentId, agentType: AGENT_TYPE, event, source: source || {} }),
    });
  } catch {
    // Fire-and-forget; never block the agent on a slow/dead hook server.
  }
}

/** Amp's thread id, reported as the provider session so a restored tab can
 *  resume this conversation. */
function threadOf(event) {
  const id = event && event.thread && event.thread.id;
  return id ? { sessionID: id } : {};
}

export default function (amp) {
  amp.on("session.start", (event) => {
    void report("session.start", threadOf(event));
  });

  amp.on("agent.start", (event) => {
    void report("agent.start", threadOf(event));
  });

  amp.on("tool.call", (event) => {
    void report("tool.call", { ...threadOf(event), tool_name: event && event.tool });
    // Observing only — the tool runs.
    return { action: "allow" };
  });

  amp.on("tool.result", (event) => {
    void report("tool.result", { ...threadOf(event), tool_name: event && event.tool });
  });

  amp.on("agent.end", (event) => {
    // `status` distinguishes a finished turn from one that died, which is the
    // difference between `done` and a real `blocked`.
    void report("agent.end", {
      ...threadOf(event),
      status: event && event.status,
      last_assistant_message: event && event.message,
    });
  });
}
