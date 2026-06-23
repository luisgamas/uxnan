#!/usr/bin/env node
// Uxnan Desktop — Claude Code hook script.
//
// Claude Code invokes this script on the events listed below (see Claude's
// "hooks" docs). The script reads the JSON payload on stdin, maps the event to
// a precise state (working / blocked / waiting / done), and POSTs it to the
// ADE's local hook server (endpoint, token and agent id from env). It then
// exits 0 with no stdout — we never try to control Claude's flow; we just
// report state as a side-effect.
//
// Maps:
//   UserPromptSubmit       -> working          (the agent received a prompt)
//   PreToolUse             -> working + tool   (the agent is calling a tool)
//   PreCompact             -> working          (compacting context)
//   Notification(prompt)   -> waiting          (Claude is asking for input)
//   Notification(auth)     -> waiting
//   Notification(idle)     -> waiting
//   PermissionRequest      -> waiting
//   Stop / SessionEnd      -> done
//   Notification(other)   -> blocked          (informational — e.g. error)
//   SubagentStart/Stop     -> (no report; the parent session owns the state)
//
// No deps; only `node:http`. Safe-by-default: if UXNAN_HOOK_URL is missing or
// the server is unreachable, the script logs nothing and exits 0 so Claude
// keeps running.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const { URL } = require('node:url');

/** Max length of the response preview we attach to a `done` report. */
const PREVIEW_MAX = 240;

/** Flatten a Claude message `content` (string, or array of blocks) to plain
 *  text — only `text` blocks contribute; tool calls/results are ignored. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** Collapse whitespace and truncate for a one-glance notification preview. */
function tidy(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** Read a Claude transcript (JSONL) and return the last user prompt + the last
 *  assistant text response, for enriching the `done` notification. Best-effort:
 *  any read/parse problem yields empty fields. */
function transcriptPreview(path) {
  const out = { prompt: null, summary: null };
  if (!path || typeof path !== 'string') return out;
  let raw;
  try { raw = fs.readFileSync(path, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const msg = entry && entry.message;
    const role = (msg && msg.role) || entry.type;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = tidy(textOf(msg ? msg.content : ''), PREVIEW_MAX);
    if (!text) continue;
    if (role === 'user') out.prompt = text;
    else out.summary = text;
  }
  return out;
}

const HOOK_URL = process.env.UXNAN_HOOK_URL || '';
const HOOK_TOKEN = process.env.UXNAN_HOOK_TOKEN || '';
const AGENT_ID = process.env.UXNAN_AGENT_ID || '';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // If stdin is empty / closed, resolve with ''.
    process.stdin.on('error', () => resolve(''));
  });
}

function postState(payload, done) {
  if (!HOOK_URL) { done(); return; }
  let url;
  try { url = new URL(HOOK_URL); }
  catch { done(); return; }
  const body = JSON.stringify(payload);
  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-uxnan-token': HOOK_TOKEN,
      },
      timeout: 3000,
    },
    (res) => { res.on('data', () => {}); res.on('end', done); },
  );
  req.on('error', done);
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  req.write(body);
  req.end();
}

// Map a Claude hook event to our normalized state. Returns the report fields
// (status + optional tool / prompt) or null to skip reporting entirely.
function mapEvent(evt) {
  switch (evt.hook_event_name) {
    case 'UserPromptSubmit':
      return {
        status: 'working',
        tool: null,
        prompt: typeof evt.prompt === 'string' ? evt.prompt : null,
      };
    case 'PreToolUse':
      return {
        status: 'working',
        tool: typeof evt.tool_name === 'string' ? evt.tool_name : null,
        prompt: null,
      };
    case 'PreCompact':
      return { status: 'working', tool: 'compact', prompt: null };
    case 'PermissionRequest':
      return { status: 'waiting', tool: null, prompt: null };
    case 'Notification': {
      const t = evt.notification_type;
      if (t === 'permission_prompt' || t === 'idle_prompt' ||
          t === 'auth_success'   || t === 'elicitation_dialog') {
        return { status: 'waiting', tool: null, prompt: null };
      }
      return { status: 'blocked', tool: null, prompt: null };
    }
    case 'Stop':
    case 'SessionEnd':
      return { status: 'done', tool: null, prompt: null };
    case 'SubagentStart':
    case 'SubagentStop':
    default:
      return null;
  }
}

(async function main() {
  let raw = '';
  try { raw = await readStdin(); } catch { /* ignore */ }
  let evt = {};
  try { evt = raw ? JSON.parse(raw) : {}; } catch { /* ignore bad JSON */ }
  const mapped = mapEvent(evt);
  if (!mapped) { return; }
  let prompt = mapped.prompt;
  let summary = null;
  // On completion, enrich with the task (last user prompt) + a short preview of
  // the response (last assistant text), read from the session transcript.
  if (mapped.status === 'done') {
    const t = transcriptPreview(evt.transcript_path);
    if (t.prompt) prompt = t.prompt;
    summary = t.summary;
  }
  const payload = {
    agentId: AGENT_ID,
    status: mapped.status,
    agentType: 'claude',
    tool: mapped.tool,
    prompt,
    summary,
    interrupted: false,
  };
  postState(payload, () => { /* fire-and-forget */ });
})();
