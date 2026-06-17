import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLanServer, type LanServerHandle } from '../../src/transport/lan-server.js';

async function withServer(
  onPairResolve: ((code: string, ip: string) => { status: number; json: unknown }) | undefined,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const handle: LanServerHandle = await startLanServer({
    port: 0,
    host: '127.0.0.1',
    onConnection: () => {},
    ...(onPairResolve ? { onPairResolve } : {}),
  });
  try {
    await run(handle.port);
  } finally {
    await handle.close();
  }
}

const get = (port: number, path: string) =>
  fetch(`http://127.0.0.1:${port}${path}`).then(async (r) => ({
    status: r.status,
    body: (await r.json()) as Record<string, unknown>,
  }));

test('GET /pair/resolve returns the payload for a valid code', async () => {
  await withServer(
    (code) =>
      code === 'GOOD'
        ? { status: 200, json: { paired: true } }
        : { status: 403, json: { error: 'bad' } },
    async (port) => {
      const ok = await get(port, '/pair/resolve?code=GOOD');
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body, { paired: true });

      const bad = await get(port, '/pair/resolve?code=NOPE');
      assert.equal(bad.status, 403);

      const missing = await get(port, '/pair/resolve');
      assert.equal(missing.status, 400);

      const wrongPath = await get(port, '/whatever');
      assert.equal(wrongPath.status, 404);
    },
  );
});

test('the pairing route 404s when no resolver is configured', async () => {
  await withServer(undefined, async (port) => {
    const res = await get(port, '/pair/resolve?code=X');
    assert.equal(res.status, 404);
    assert.equal(res.body['error'], 'pairing_disabled');
  });
});

test('POST /agent-hook/approval validates the token and returns the decision', async () => {
  const handle = await startLanServer({
    port: 0,
    host: '127.0.0.1',
    onConnection: () => {},
    onHookApproval: (body, token) => {
      if (token !== 'secret') return Promise.resolve({ status: 403, json: { error: 'bad_token' } });
      const b = body as { toolName?: string };
      return Promise.resolve({
        status: 200,
        json: { decision: b.toolName === 'Bash' ? 'allow' : 'deny' },
      });
    },
  });
  try {
    const post = (token: string, payload: unknown) =>
      fetch(`http://127.0.0.1:${handle.port}/agent-hook/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-uxnan-hook-token': token },
        body: JSON.stringify(payload),
      }).then(async (r) => ({
        status: r.status,
        body: (await r.json()) as Record<string, unknown>,
      }));

    const ok = await post('secret', { threadId: 't', toolName: 'Bash', input: {} });
    assert.equal(ok.status, 200);
    assert.equal(ok.body['decision'], 'allow');

    const denied = await post('secret', { threadId: 't', toolName: 'Write', input: {} });
    assert.equal(denied.body['decision'], 'deny');

    const badToken = await post('wrong', { threadId: 't', toolName: 'Bash' });
    assert.equal(badToken.status, 403);
  } finally {
    await handle.close();
  }
});

test('POST /agent-hook/approval 404s when no handler is configured', async () => {
  await withServer(undefined, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/agent-hook/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 404);
  });
});
