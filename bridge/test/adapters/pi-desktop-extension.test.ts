import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import uxnanDesktopTools from '../../src/adapters/pi-desktop-extension.js';

// The extension pi loads to reach Uxnan Desktop's tools: a Streamable-HTTP MCP
// client. This server answers `initialize` over SSE with a session id, and the
// rest as plain JSON — both shapes the transport allows.
interface Seen {
  method?: string;
  headers: IncomingHttpHeaders;
}

async function withServer(run: (url: string, seen: Seen[]) => Promise<void>): Promise<void> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const msg = JSON.parse(body) as { id?: number; method: string; params?: any };
      seen.push({ method: msg.method, headers: req.headers });
      if (msg.id === undefined) return void res.writeHead(202).end();
      if (msg.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-9' });
        res.end(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', instructions: 'Call uxnan_status first.' } })}\n\n`,
        );
        return;
      }
      let result: unknown = {};
      if (msg.method === 'tools/list') {
        result = msg.params?.cursor
          ? { tools: [{ name: 'terminal_read', inputSchema: { type: 'object' } }] }
          : {
              tools: [
                { name: 'uxnan_status', title: 'Status', description: 'Report status' },
                { name: 'read', description: 'would shadow pi' },
              ],
              nextCursor: 'p2',
            };
      } else if (msg.method === 'tools/call') {
        result =
          msg.params.name === 'terminal_read'
            ? { content: [{ type: 'text', text: 'no such terminal' }], isError: true }
            : { content: [{ type: 'text', text: 'fine' }] };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/mcp`, seen);
  } finally {
    server.close();
  }
}

function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  return run().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

type Registered = Parameters<Parameters<typeof uxnanDesktopTools>[0]['registerTool']>[0];

test('the pi extension registers the desktop tools and calls them over MCP', async () => {
  await withServer(async (url, seen) => {
    const tools: Registered[] = [];
    await withEnv(
      { UXNAN_MCP_URL: url, UXNAN_MCP_TOKEN: 'tok-123', UXNAN_THREAD_CWD: '%2Fw' },
      () => uxnanDesktopTools({ registerTool: (t) => void tools.push(t) }),
    );
    // Every page listed; pi's own `read` is never shadowed.
    assert.deepEqual(
      tools.map((t) => t.name),
      ['uxnan_status', 'terminal_read'],
    );
    assert.equal(tools[0]!.label, 'Status');
    assert.deepEqual(tools[0]!.promptGuidelines, ['Call uxnan_status first.']);
    assert.equal(tools[1]!.promptGuidelines, undefined);
    assert.deepEqual(tools[0]!.parameters, { type: 'object', properties: {} });

    assert.deepEqual(await tools[0]!.execute('c1', {}, undefined), {
      content: [{ type: 'text', text: 'fine' }],
    });
    await assert.rejects(tools[1]!.execute('c2', { terminal: 'x' }, undefined), /no such terminal/);

    for (const s of seen) {
      assert.equal(s.headers['authorization'], 'Bearer tok-123');
      assert.equal(s.headers['x-uxnan-cwd'], '%2Fw');
    }
    // The session the server handed out rides every later request.
    assert.equal(seen[0]!.headers['mcp-session-id'], undefined);
    assert.ok(seen.slice(1).every((s) => s.headers['mcp-session-id'] === 'sess-9'));
  });
});

test('the pi extension registers nothing without the desktop, or when it cannot be reached', async () => {
  const tools: Registered[] = [];
  const pi = { registerTool: (t: Registered) => void tools.push(t) };
  await withEnv({ UXNAN_MCP_URL: undefined, UXNAN_MCP_TOKEN: undefined }, () =>
    uxnanDesktopTools(pi),
  );
  await withEnv({ UXNAN_MCP_URL: 'http://127.0.0.1:9/mcp', UXNAN_MCP_TOKEN: 'tok' }, () =>
    uxnanDesktopTools(pi),
  );
  assert.equal(tools.length, 0);
});
