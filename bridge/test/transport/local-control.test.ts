import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import {
  LOCAL_CONTROL_FILE,
  StreamNotification,
  makeNotification,
  makeRequest,
  type LocalControlFrame,
} from '@uxnan/shared';
import {
  RequestLanes,
  authorize,
  laneKey,
  planReplay,
  startLocalControlServer,
  type LocalControlServerHandle,
} from '../../src/transport/local-control-server.js';
import { SessionRegistry } from '../../src/transport/session-registry.js';
import { OutboundLog } from '../../src/transport/outbound-log.js';
import {
  buildDiscovery,
  mintLocalControlToken,
  parseDiscovery,
  readDiscoveryFile,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from '../../src/local-control-discovery.js';
import { InMemorySecretStore, startBridge } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

const TOKEN = 'test-token-0123456789';
const INSTANCE = 'instance-a';

function fakeRequest(input: {
  url?: string;
  remoteAddress?: string;
  authorization?: string;
  origin?: string;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (input.authorization !== undefined) headers['authorization'] = input.authorization;
  if (input.origin !== undefined) headers['origin'] = input.origin;
  return {
    url: input.url ?? '/control?client=desktop',
    headers,
    socket: { remoteAddress: input.remoteAddress ?? '127.0.0.1' },
  } as unknown as IncomingMessage;
}

test('authorize: accepts a loopback peer with the right bearer token and no Origin', () => {
  assert.equal(authorize(fakeRequest({ authorization: `Bearer ${TOKEN}` }), TOKEN), undefined);
  assert.equal(
    authorize(fakeRequest({ authorization: `Bearer ${TOKEN}`, remoteAddress: '::1' }), TOKEN),
    undefined,
  );
});

test('authorize: refuses a missing, malformed or wrong token', () => {
  assert.equal(authorize(fakeRequest({}), TOKEN), 401);
  assert.equal(authorize(fakeRequest({ authorization: TOKEN }), TOKEN), 401);
  assert.equal(authorize(fakeRequest({ authorization: 'Bearer nope' }), TOKEN), 401);
});

test('authorize: refuses any browser (Origin header) even with the right token', () => {
  const req = fakeRequest({ authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' });
  assert.equal(authorize(req, TOKEN), 403);
});

test('authorize: refuses a non-loopback peer and an unknown path', () => {
  assert.equal(
    authorize(
      fakeRequest({ authorization: `Bearer ${TOKEN}`, remoteAddress: '192.168.1.20' }),
      TOKEN,
    ),
    403,
  );
  assert.equal(
    authorize(fakeRequest({ authorization: `Bearer ${TOKEN}`, url: '/other' }), TOKEN),
    404,
  );
});

test('planReplay: a fresh client has nothing to replay and no gap', () => {
  const log = new OutboundLog();
  log.record(Buffer.from('{}'));
  assert.deepEqual(planReplay(log, { resume: 0, instance: undefined }, INSTANCE), {
    entries: [],
    gap: false,
  });
});

test('planReplay: same run replays what the client missed', () => {
  const log = new OutboundLog();
  for (let i = 0; i < 5; i++) log.record(Buffer.from(`{"n":${i}}`));
  const plan = planReplay(log, { resume: 3, instance: INSTANCE }, INSTANCE);
  assert.deepEqual(
    plan.entries.map((e) => e.seq),
    [4, 5],
  );
  assert.equal(plan.gap, false);
});

test('planReplay: an evicted window is reported as a gap', () => {
  const log = new OutboundLog(2, 1_000_000);
  for (let i = 0; i < 5; i++) log.record(Buffer.from(`{"n":${i}}`));
  // Retained: 4 and 5. The client applied 1 and needs 2 onwards.
  const plan = planReplay(log, { resume: 1, instance: INSTANCE }, INSTANCE);
  assert.equal(plan.gap, true);
  assert.deepEqual(
    plan.entries.map((e) => e.seq),
    [4, 5],
  );
});

test('planReplay: a client from another bridge run must resync', () => {
  const log = new OutboundLog();
  log.record(Buffer.from('{}'));
  assert.deepEqual(planReplay(log, { resume: 42, instance: 'older-run' }, INSTANCE), {
    entries: [],
    gap: true,
  });
});

test('laneKey: requests naming a thread share its lane; others run free', () => {
  assert.equal(laneKey(makeRequest(1, 'turn/send', { threadId: 't1', text: 'x' })), 'thread:t1');
  assert.equal(laneKey(makeRequest(2, 'agent/list')), undefined);
  assert.equal(laneKey(null), undefined);
  assert.equal(laneKey({ params: { threadId: '' } }), undefined);
});

test('RequestLanes: one lane runs in order even when the first task is slower', async () => {
  const lanes = new RequestLanes();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  lanes.run('thread:a', async () => {
    await gate;
    order.push('first');
  });
  lanes.run('thread:a', async () => {
    order.push('second');
  });
  lanes.run(undefined, async () => {
    order.push('free');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['free']);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, ['free', 'first', 'second']);
});

test('RequestLanes: a failing task does not block its lane', async () => {
  const lanes = new RequestLanes();
  const order: string[] = [];
  lanes.run('thread:a', async () => {
    throw new Error('boom');
  });
  lanes.run('thread:a', async () => {
    order.push('after');
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, ['after']);
});

// --- Over a real socket -----------------------------------------------------

interface Client {
  ws: WebSocket;
  frames: LocalControlFrame[];
  next(): Promise<LocalControlFrame>;
}

function connect(
  port: number,
  query: string,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/control?${query}`, { headers });
    const frames: LocalControlFrame[] = [];
    const waiters: ((f: LocalControlFrame) => void)[] = [];
    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as LocalControlFrame;
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
    });
    ws.once('open', () =>
      resolve({
        ws,
        frames,
        next: () =>
          new Promise((res) => {
            const buffered = frames.shift();
            if (buffered) res(buffered);
            else waiters.push(res);
          }),
      }),
    );
    ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

async function withServer(
  run: (
    handle: LocalControlServerHandle,
    registry: SessionRegistry,
    events: string[],
  ) => Promise<void>,
): Promise<void> {
  const registry = new SessionRegistry();
  const events: string[] = [];
  const handle = await startLocalControlServer({
    port: 0,
    token: TOKEN,
    bridgeVersion: '9.9.9',
    instanceId: INSTANCE,
    registry,
    dispatch: async (raw) => {
      const req = raw as { id: number; method: string };
      return { jsonrpc: '2.0', id: req.id, result: { echoed: req.method } };
    },
    onClientConnected: (id) => events.push(`connected:${id}`),
    onClientDisconnected: (id) => events.push(`disconnected:${id}`),
  });
  try {
    await run(handle, registry, events);
  } finally {
    await handle.close();
  }
}

test('socket: hello, request/response and broadcast notifications with seq', async () => {
  await withServer(async (handle, registry, events) => {
    const client = await connect(handle.port, 'client=desktop');
    const hello = await client.next();
    assert.equal(hello.type, 'hello');
    assert.equal(hello.type === 'hello' && hello.instanceId, INSTANCE);
    assert.equal(hello.type === 'hello' && hello.gap, false);
    assert.deepEqual(handle.connectedClients(), ['desktop']);
    assert.deepEqual(events, ['connected:desktop']);
    // It counts as a live receiver for the approval countdown.
    assert.equal(registry.anyActive(), true);

    client.ws.send(JSON.stringify(makeRequest(7, 'bridge/status')));
    const reply = await client.next();
    assert.equal(reply.type, 'message');
    assert.equal(reply.type === 'message' && reply.seq, undefined);
    assert.deepEqual(reply.type === 'message' && reply.message, {
      jsonrpc: '2.0',
      id: 7,
      result: { echoed: 'bridge/status' },
    });

    registry.broadcast(
      makeNotification(StreamNotification.TurnStarted, { threadId: 't', turnId: 'u' }),
    );
    const note = await client.next();
    assert.equal(note.type === 'message' && note.seq, 1);
    client.ws.close();
  });
});

test('socket: a reconnect resumes from the last seq it applied', async () => {
  await withServer(async (handle, registry) => {
    const first = await connect(handle.port, 'client=desktop');
    await first.next(); // hello
    registry.broadcast(makeNotification('stream/turn/started', { n: 1 }));
    await first.next();
    first.ws.close();
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Two notifications arrive while it is away; the log keeps them.
    registry.broadcast(makeNotification('stream/turn/started', { n: 2 }));
    registry.broadcast(makeNotification('stream/turn/started', { n: 3 }));

    const second = await connect(handle.port, `client=desktop&resume=1&instance=${INSTANCE}`);
    const hello = await second.next();
    assert.equal(hello.type === 'hello' && hello.replayed, 2);
    assert.equal(hello.type === 'hello' && hello.gap, false);
    const a = await second.next();
    const b = await second.next();
    assert.deepEqual(
      [a, b].map((f) => (f.type === 'message' ? f.seq : -1)),
      [2, 3],
    );
    second.ws.close();
  });
});

test('socket: a newer connection for the same client supersedes the older one', async () => {
  await withServer(async (handle) => {
    const first = await connect(handle.port, 'client=desktop');
    await first.next();
    const closed = new Promise<number>((resolve) =>
      first.ws.once('close', (code) => resolve(code)),
    );
    const second = await connect(handle.port, 'client=desktop');
    await second.next();
    assert.equal(await closed, 4000);
    assert.deepEqual(handle.connectedClients(), ['desktop']);
    second.ws.close();
  });
});

test('socket: refuses a wrong token, a browser origin and a bad client id', async () => {
  await withServer(async (handle) => {
    await assert.rejects(
      connect(handle.port, 'client=desktop', { authorization: 'Bearer wrong' }),
      /status 401/,
    );
    await assert.rejects(
      connect(handle.port, 'client=desktop', {
        authorization: `Bearer ${TOKEN}`,
        origin: 'http://localhost:3000',
      }),
      /status 403/,
    );
    await assert.rejects(connect(handle.port, 'client=Not_Valid'), /status 400/);
    assert.deepEqual(handle.connectedClients(), []);
  });
});

// --- Discovery file ---------------------------------------------------------

test('discovery: round-trips, is owner-only, and is removed only by its owner', async () => {
  const dir = join(tmpdir(), `uxnan-lc-${randomUUID()}`);
  const path = join(dir, LOCAL_CONTROL_FILE);
  try {
    const token = mintLocalControlToken();
    assert.ok(token.length >= 40);
    const discovery = buildDiscovery({
      port: 4242,
      token,
      pid: 1,
      bridgeVersion: '1.0.0',
      instanceId: INSTANCE,
    });
    await writeDiscoveryFile(path, discovery);
    assert.deepEqual(await readDiscoveryFile(path), discovery);
    if (process.platform !== 'win32') {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
    // Another run's token does not remove it.
    await removeDiscoveryFile(path, 'someone-else');
    assert.ok(await readDiscoveryFile(path));
    await removeDiscoveryFile(path, token);
    assert.equal(await readDiscoveryFile(path), undefined);
  } finally {
    await rmrf(dir);
  }
});

test('discovery: parse rejects malformed contents', () => {
  assert.equal(parseDiscovery('not json'), undefined);
  assert.equal(parseDiscovery('{}'), undefined);
  assert.equal(
    parseDiscovery(
      JSON.stringify({
        protocol: 1,
        port: 70000,
        token: 't',
        pid: 1,
        bridgeVersion: 'v',
        instanceId: 'i',
      }),
    ),
    undefined,
  );
  assert.equal(
    parseDiscovery(
      JSON.stringify({
        protocol: 1,
        port: 1,
        token: '',
        pid: 1,
        bridgeVersion: 'v',
        instanceId: 'i',
      }),
    ),
    undefined,
  );
});

// --- Through a real bridge --------------------------------------------------

test('bridge: startLocalControl publishes the file, serves the router, and cleans up', async () => {
  const baseDir = join(tmpdir(), `uxnan-bridge-lc-${randomUUID()}`);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  try {
    assert.equal(bridge.status().features?.localControl, undefined);
    const { port } = await bridge.startLocalControl();
    const discovery = await readDiscoveryFile(join(baseDir, LOCAL_CONTROL_FILE));
    assert.ok(discovery);
    assert.equal(discovery.port, port);
    assert.equal(discovery.pid, process.pid);
    assert.equal(bridge.status().features?.localControl, true);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/control?client=desktop`, {
      headers: { authorization: `Bearer ${discovery.token}` },
    });
    const frames: LocalControlFrame[] = [];
    const got = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const check = (): void => {
          if (frames.length >= n) resolve();
          else setTimeout(check, 5);
        };
        check();
      });
    ws.on('message', (data) => frames.push(JSON.parse(data.toString()) as LocalControlFrame));
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify(makeRequest('s', 'bridge/status')));
    await got(2);
    const reply = frames[1];
    assert.ok(reply && reply.type === 'message');
    const result = (reply.message as { result: { features: { localControl?: boolean } } }).result;
    // The same router answers over this channel as over the phones' one.
    assert.equal(result.features.localControl, true);
    ws.close();
  } finally {
    await bridge.stop();
    assert.equal(await readDiscoveryFile(join(baseDir, LOCAL_CONTROL_FILE)), undefined);
    await rmrf(baseDir);
  }
});
