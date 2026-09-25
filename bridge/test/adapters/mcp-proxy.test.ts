import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyServerAnswer, proxyLaunchEnv, runMcpProxy } from '../../src/adapters/mcp-proxy.js';
import {
  configFileFor,
  ensureGlobalEntry,
  removeGlobalEntry,
  type GlobalEntryEnvironment,
} from '../../src/agents/global-mcp-entry.js';

// Zero and Antigravity reach Uxnan Desktop's tools through one secret-free
// global entry that runs this proxy (architecture/02a §5.8.15).

async function drive(
  env: NodeJS.ProcessEnv,
  messages: unknown[],
  cwd = '/w/a b',
): Promise<unknown[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: unknown[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  const done = runMcpProxy({ input, output, env, cwd, version: '9.9.9' });
  for (const m of messages) input.write(`${JSON.stringify(m)}\n`);
  input.end();
  await done;
  return lines;
}

test('outside a bridge run the proxy is a server with no tools, and says so', async () => {
  const answers = (await drive({}, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'x' } },
  ])) as { id: number; result?: any; error?: any }[];
  assert.deepEqual(
    answers.map((a) => a.id),
    [1, 2, 3],
    'one answer per request, none for the notification',
  );
  assert.equal(answers[0]?.result.protocolVersion, '2024-11-05');
  assert.deepEqual(answers[1]?.result, { tools: [] });
  assert.ok(answers[2]?.error);
  assert.equal(emptyServerAnswer({ id: 4, method: 'ping' }, '1').result !== undefined, true);
});

test('inside a bridge run the proxy forwards to the desktop with its token and folder', async () => {
  const seen: { method?: string; auth?: string; cwd?: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const msg = JSON.parse(body) as { id?: number; method: string };
      seen.push({
        method: msg.method,
        auth: req.headers.authorization,
        cwd: req.headers['x-uxnan-cwd'] as string,
      });
      if (msg.id === undefined) return void res.writeHead(202).end();
      const result =
        msg.method === 'tools/list' ? { tools: [{ name: 'uxnan_status' }] } : { ok: msg.method };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    const env = { UXNAN_MCP_URL: `http://127.0.0.1:${port}/mcp`, UXNAN_MCP_TOKEN: 'tok' };
    const answers = (await drive(env, [
      { jsonrpc: '2.0', id: 'a', method: 'initialize', params: {} },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
    ])) as { id: string; result: any }[];
    assert.deepEqual(
      answers.map((a) => a.id),
      ['a', 'b'],
    );
    assert.deepEqual(answers[1]?.result, { tools: [{ name: 'uxnan_status' }] });
    assert.deepEqual(
      seen.map((s) => s.method),
      ['initialize', 'notifications/initialized', 'tools/list'],
    );
    // No folder in the environment → the proxy's own folder (the conversation's).
    assert.ok(seen.every((s) => s.auth === 'Bearer tok' && s.cwd === encodeURIComponent('/w/a b')));
  } finally {
    server.close();
  }
  // Desktop gone: discovery still answers (no tools), a call fails honestly.
  const offline = (await drive({ UXNAN_MCP_URL: 'http://127.0.0.1:9/mcp', UXNAN_MCP_TOKEN: 't' }, [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'x' } },
  ])) as { result?: any; error?: any }[];
  assert.deepEqual(offline[0]?.result, { tools: [] });
  assert.ok(offline[1]?.error);
});

test('the launch environment carries the endpoint only while attached', () => {
  assert.deepEqual(proxyLaunchEnv(undefined), { env: {}, key: '' });
  const desktop = { mcpUrl: 'http://127.0.0.1:1/mcp', token: 'k'.repeat(43) };
  const shared = proxyLaunchEnv(desktop);
  assert.deepEqual(Object.keys(shared.env).sort(), ['UXNAN_MCP_TOKEN', 'UXNAN_MCP_URL']);
  assert.ok(!shared.key.includes(desktop.token));
  assert.equal(proxyLaunchEnv(desktop, '/w/x y').env['UXNAN_THREAD_CWD'], '%2Fw%2Fx%20y');
});

test('the global entry is added once, left alone when right, and removed on uninstall', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxnan-entry-'));
  try {
    const calls: string[][] = [];
    const where: GlobalEntryEnvironment = {
      home,
      env: {},
      run: async (command, args) => {
        calls.push([command, ...args]);
      },
    };
    const located = { binaryPath: '/bin/agy', prependArgs: [], available: true, checked: [] };
    const wanted = { command: '/n/node', args: ['/b/cli.js', 'mcp-proxy'] };
    assert.equal(await ensureGlobalEntry('antigravity-cli', located, wanted, where), 'added');
    assert.deepEqual(calls[0], [
      '/bin/agy',
      'mcp',
      'add',
      'uxnan-browser',
      '--',
      '/n/node',
      '/b/cli.js',
      'mcp-proxy',
    ]);
    // Once the CLI stored it, nothing more is written.
    const file = configFileFor('antigravity-cli', where);
    assert.equal(file, join(home, '.gemini', 'config', 'mcp_config.json'));
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ mcpServers: { 'uxnan-browser': { ...wanted, disabled: false } } }),
    );
    assert.equal(await ensureGlobalEntry('antigravity-cli', located, wanted, where), 'present');
    assert.equal(calls.length, 1);
    // A moved bridge (another node or path) is re-registered.
    assert.equal(
      await ensureGlobalEntry(
        'antigravity-cli',
        located,
        { ...wanted, command: '/other/node' },
        where,
      ),
      'added',
    );
    assert.equal(await removeGlobalEntry('antigravity-cli', located, where), true);
    assert.deepEqual(calls.at(-1), ['/bin/agy', 'mcp', 'remove', 'uxnan-browser']);
    // Nothing to remove once the entry is gone.
    await rm(file);
    assert.equal(await removeGlobalEntry('antigravity-cli', located, where), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
