#!/usr/bin/env node
// Uxnan Desktop — agent status relay (Layer 1 hook bridge).
//
// A dependency-free Node relay for Claude Code, whose own hook runner executes
// it and pipes the provider's hook JSON
// to it on stdin. The relay forwards the raw event (plus the agent kind, baked
// into the invocation by the ADE) to the local hook server; the server turns the
// event name into a precise lifecycle state (working / waiting / done / blocked)
// and enriches it (prompt / tool / the `done` response preview from Claude's
// transcript). Keeping normalization on the server means this script stays dumb
// and shell-agnostic — `node "<relay>"` (or exec-form `node`) resolves the same
// under cmd, PowerShell, PowerShell 7, Git Bash, WSL, bash, zsh or fish.
//
// Fail-open by design: any error (missing env, dead server, bad JSON) is
// swallowed. It prints nothing because Claude treats some hook stdout as context.
//
// Survives an app restart: the ADE injects UXNAN_HOOK_URL/TOKEN frozen at spawn,
// and also UXNAN_ENDPOINT_FILE — a file the ADE rewrites every launch with the
// live url/token. We prefer the file (always fresh) and fall back to the env.

"use strict";

function readEndpointFile(path) {
  try {
    const text = require("fs").readFileSync(path, "utf8");
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^(?:set\s+)?([A-Za-z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/\r$/, "");
    }
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
// terminal that outlived an app restart), so it is tried when the first POST
// fails.
function coordCandidates() {
  const out = [];
  const envUrl = process.env.UXNAN_HOOK_URL || "";
  if (envUrl) {
    out.push({ url: envUrl, token: process.env.UXNAN_HOOK_TOKEN || "" });
  }
  const file = process.env.UXNAN_ENDPOINT_FILE
    ? readEndpointFile(process.env.UXNAN_ENDPOINT_FILE)
    : {};
  if (file.UXNAN_HOOK_URL && file.UXNAN_HOOK_URL !== envUrl) {
    out.push({ url: file.UXNAN_HOOK_URL, token: file.UXNAN_HOOK_TOKEN || "" });
  }
  return out;
}

function eventName(input) {
  return String(
    input.hook_event_name ||
      input.hookEventName ||
      input.event ||
      input.type ||
      input.name ||
      "",
  );
}

function post(url, token, agentId, agentType, body) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return resolve(false);
    }
    const transport = parsed.protocol === "https:" ? require("https") : require("http");
    const data = JSON.stringify(body);
    const req = transport.request(
      parsed,
      {
        method: "POST",
        timeout: 1500,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          "X-Uxnan-Token": token,
          "X-Uxnan-Agent-Id": agentId,
          "X-Uxnan-Agent-Type": agentType,
        },
      },
      (res) => {
        res.resume();
        // 2xx only: a 401 from another window's server is a failed attempt, not
        // a delivery, and must let the next candidate be tried.
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        res.on("end", () => resolve(ok));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end(data);
  });
}

function parseAgent(argv) {
  let agent = process.env.UXNAN_AGENT_TYPE || "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent" && argv[i + 1]) agent = argv[i + 1];
  }
  return agent;
}

function main() {
  const agentType = parseAgent(process.argv.slice(2));
  const finish = () => {};

  const candidates = coordCandidates();
  const agentId = process.env.UXNAN_AGENT_ID || "";

  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let input = {};
    try {
      input = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      input = {};
    }
    const ev = eventName(input);
    if (candidates.length === 0 || !agentId || !ev || !agentType) {
      finish();
      return;
    }
    const body = { agentId, agentType, event: ev, source: input };
    // Try each candidate in turn, stopping at the first that accepts it.
    const attempt = (i) => {
      if (i >= candidates.length) return finish();
      post(candidates[i].url, candidates[i].token, agentId, agentType, body).then(
        (ok) => (ok ? finish() : attempt(i + 1)),
        () => attempt(i + 1),
      );
    };
    attempt(0);
  });
  process.stdin.on("error", finish);
}

main();
