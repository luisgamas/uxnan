#!/usr/bin/env node
// Uxnan Desktop — agent status relay (Layer 1 hook bridge).
//
// One dependency-free Node script shared by the two agents that guarantee `node`
// on their PATH (they *are* Node programs): Claude Code and Gemini CLI. The
// agent's own hook runner executes this relay and pipes the provider's hook JSON
// to it on stdin. The relay forwards the raw event (plus the agent kind, baked
// into the invocation by the ADE) to the local hook server; the server turns the
// event name into a precise lifecycle state (working / waiting / done / blocked)
// and enriches it (prompt / tool / the `done` response preview from Claude's
// transcript). Keeping normalization on the server means this script stays dumb
// and shell-agnostic — `node "<relay>"` (or exec-form `node`) resolves the same
// under cmd, PowerShell, PowerShell 7, Git Bash, WSL, bash, zsh or fish.
//
// Fail-open by design: any error (missing env, dead server, bad JSON) is
// swallowed. Gemini reads its hook's stdout as JSON, so for `--agent gemini` we
// print a trailing `{}`; Claude treats some events' stdout as context, so we
// print nothing for it.
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

function resolveCoords() {
  // Prefer the endpoint file (rewritten every launch) over the spawn-frozen env,
  // so a terminal that outlived an app restart still reaches the live server.
  const file = process.env.UXNAN_ENDPOINT_FILE
    ? readEndpointFile(process.env.UXNAN_ENDPOINT_FILE)
    : {};
  const url = file.UXNAN_HOOK_URL || process.env.UXNAN_HOOK_URL || "";
  const token = file.UXNAN_HOOK_TOKEN || process.env.UXNAN_HOOK_TOKEN || "";
  return { url, token };
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
      return resolve();
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
        res.on("end", resolve);
      },
    );
    req.on("error", resolve);
    req.on("timeout", () => {
      req.destroy();
      resolve();
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
  // Gemini parses its hook's stdout as JSON; Claude injects some events' stdout
  // into context. Only echo an empty object for Gemini.
  const echoJson = agentType === "gemini";
  const finish = () => {
    if (echoJson) process.stdout.write("{}\n");
  };

  const { url, token } = resolveCoords();
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
    if (url && agentId && ev && agentType) {
      post(url, token, agentId, agentType, {
        agentId,
        agentType,
        event: ev,
        source: input,
      }).then(finish, finish);
    } else {
      finish();
    }
  });
  process.stdin.on("error", finish);
}

main();
