/**
 * A fake `opencode` binary for tests: a small Node program that answers
 * `--version`, a one-shot `run`, and `serve` — an HTTP server speaking the V1
 * or V2 routes (V2 behind the Basic-auth password it is given, as the real one),
 * streaming scripted events after each prompt. The real transport, routes,
 * password handling and translators run against it, on every platform.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnFn, SpawnedProcess } from '../../src/index.js';

export interface FakeOpenCodeScript {
  /** Events streamed after each prompt (V1 `{ type, properties }`, V2 `{ type, data }`). */
  onPrompt?: Record<string, unknown>[];
  /** V2 `GET /api/model` entries (served from the second call on: the catalog loads late). */
  models?: Record<string, unknown>[];
  /** V2 history pages (`page2` is served for `cursor=c2`). */
  page1?: unknown[];
  page2?: unknown[];
  /** V1 `GET /session/:id/message`. */
  v1Messages?: unknown[];
  /** V2 `GET /api/command` (served from the second call on: the catalog loads late). */
  commands?: Record<string, unknown>[];
  /** V2 `GET /api/skill`. */
  skills?: Record<string, unknown>[];
  /** V1 `GET /command` (commands and skills, `source` telling them apart). */
  v1Commands?: Record<string, unknown>[];
  /** A command request is refused with this status (an unknown command). */
  commandStatus?: number;
}

/** One request the fake received. */
export interface FakeRequest {
  method: string;
  url: string;
  auth: string | null;
  body: unknown;
}

const PROGRAM = String.raw`
import http from 'node:http';
import fs from 'node:fs';
const version = process.env.FAKE_OC_VERSION;
const log = process.env.FAKE_OC_LOG;
const script = JSON.parse(process.env.FAKE_OC_SCRIPT || '{}');
const record = (entry) => fs.appendFileSync(log, JSON.stringify(entry) + '\n');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log(version === '2' ? 'opencode v2.0.16' : '1.18.32');
  process.exit(0);
}
if (args[0] === 'models') {
  // OpenCode 1's CLI catalog: ids, and with --verbose each id's JSON.
  console.log('opencode/big-pickle');
  if (args.includes('--verbose')) console.log('{\n  "limit": {\n    "context": 200000\n  }\n}');
  process.exit(0);
}
if (args[0] === 'run') {
  record({ run: args });
  console.log('A Fake Title');
  process.exit(0);
}
const password = process.env.OPENCODE_SERVER_PASSWORD;
const expected = password ? 'Basic ' + Buffer.from('opencode:' + password).toString('base64') : null;
const streams = new Set();
let modelCalls = 0;
let commandCalls = 0;
const send = (event) => { for (const s of streams) s.write('data: ' + JSON.stringify(event) + '\n\n'); };
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : undefined;
    record({ method: req.method, url: req.url, auth: req.headers.authorization || null, body });
    if (version === '2' && req.headers.authorization !== expected) { res.writeHead(401); res.end(); return; }
    const json = (value) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const path = req.url.split('?')[0];
    if (path === (version === '2' ? '/api/event' : '/event')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': connected\n\n');
      streams.add(res);
      res.on('close', () => streams.delete(res));
      return;
    }
    if (path.endsWith('/command') && req.method === 'POST') {
      if (script.commandStatus) { res.writeHead(script.commandStatus); res.end(); return; }
      const events = script.onPrompt || [];
      if (version === '2') {
        res.writeHead(204); res.end();
        setTimeout(() => events.forEach(send), 30);
        return;
      }
      // V1 answers only once the turn is over, its events streamed first.
      setTimeout(() => events.forEach(send), 30);
      setTimeout(() => json({ info: { role: 'assistant' }, parts: [] }), 150);
      return;
    }
    if (path.endsWith('/prompt') || path.endsWith('/prompt_async')) {
      json({});
      const events = script.onPrompt || [];
      setTimeout(() => events.forEach(send), 30);
      return;
    }
    if (version === '2') {
      if (path === '/api/model') { modelCalls++; return json({ data: modelCalls < 2 ? [] : script.models || [] }); }
      if (path === '/api/command') { commandCalls++; return json({ data: commandCalls < 2 ? [] : script.commands || [] }); }
      if (path === '/api/skill') return json({ data: script.skills || [] });
      if (path === '/api/session' && req.method === 'POST') return json({ data: { id: 'ses_1' } });
      if (path.endsWith('/message')) {
        return json(req.url.includes('cursor=c2')
          ? { data: script.page2 || [], cursor: { next: null } }
          : { data: script.page1 || [], cursor: { next: script.page2 ? 'c2' : null } });
      }
      return json({});
    }
    if (path === '/session' && req.method === 'POST') return json({ id: 'ses_1' });
    if (path === '/command' && req.method === 'GET') return json(script.v1Commands || []);
    if (path.endsWith('/message')) return json(script.v1Messages || []);
    return json({});
  });
}).listen(0, '127.0.0.1', function () {
  console.log('opencode server listening on http://127.0.0.1:' + this.address().port);
});
`;

export interface FakeOpenCode {
  /** Spawns the fake whatever command the caller names (`opencode`, a path, …). */
  spawnFn: SpawnFn;
  /** Everything the fake received so far, in order. */
  requests(): FakeRequest[];
  /** The one-shot `run` invocations' arguments. */
  runs(): string[][];
}

/** A fake `opencode` of the given major version, running `script`. */
export function fakeOpenCode(version: 1 | 2, script: FakeOpenCodeScript = {}): FakeOpenCode {
  const dir = mkdtempSync(join(tmpdir(), 'uxnan-fake-opencode-'));
  const program = join(dir, 'opencode.mjs');
  const log = join(dir, 'requests.jsonl');
  writeFileSync(program, PROGRAM);
  writeFileSync(log, '');
  const entries = (): Record<string, unknown>[] =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];
  return {
    spawnFn: (_command, args, cwd, extra) =>
      spawn(process.execPath, [program, ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          ...extra?.env,
          FAKE_OC_VERSION: String(version),
          FAKE_OC_LOG: log,
          FAKE_OC_SCRIPT: JSON.stringify(script),
        },
      }) as unknown as SpawnedProcess,
    requests: () => entries().filter((e) => 'method' in e) as unknown as FakeRequest[],
    runs: () => entries().flatMap((e) => (Array.isArray(e['run']) ? [e['run'] as string[]] : [])),
  };
}

/** Resolve once `predicate` holds, or fail after `ms`. */
export async function waitUntil(predicate: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}
