import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { RelayServer } from '../src/index.js';

async function openRaw(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 2000,
): Promise<{ ok: true; ws: WebSocket } | { ok: false; status: number }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: { ok: true; ws: WebSocket } | { ok: false; status: number }): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      settle({ ok: false, status: 0 });
    }, timeoutMs);
    // The `ws` library fires `unexpected-response` (not `error`) when the
    // server returns a non-101 status during upgrade — this is how we detect
    // a CSWSH rejection (e.g. our 403 from the relay).
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      settle({ ok: false, status: res.statusCode ?? 0 });
      try {
        res.resume();
      } catch {
        /* ignore */
      }
    });
    ws.once('error', () => {
      clearTimeout(timer);
      // Network-level error during/after upgrade; treat as rejection.
      settle({ ok: false, status: 0 });
    });
    ws.once('open', () => {
      clearTimeout(timer);
      ws.off('error', () => {});
      settle({ ok: true, ws });
    });
  });
}

test('upgrade without Origin is accepted (server-to-server client)', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  try {
    const result = await openRaw(`ws://127.0.0.1:${port}`, {
      'x-role': 'mac',
      'x-session-id': 's1',
    });
    assert.equal(result.ok, true, 'Origin-less upgrade should succeed');
    result.ws.close();
  } finally {
    await close();
  }
});

test('upgrade with same-host Origin is accepted (browser same-origin)', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  try {
    const host = `127.0.0.1:${port}`;
    const result = await openRaw(`ws://${host}`, {
      'x-role': 'mac',
      'x-session-id': 's2',
      origin: `http://${host}`,
    });
    assert.equal(result.ok, true, 'same-host Origin should be accepted');
    result.ws.close();
  } finally {
    await close();
  }
});

test('upgrade with cross-host Origin is rejected (CSWSH defense)', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  try {
    const result = await openRaw(`ws://127.0.0.1:${port}`, {
      'x-role': 'mac',
      'x-session-id': 's3',
      origin: 'http://evil.example.com',
    });
    assert.equal(result.ok, false, 'cross-host Origin must be rejected');
    assert.equal(result.status, 403, 'rejected with 403');
  } finally {
    await close();
  }
});

test('upgrade with malformed Origin is rejected', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  try {
    const result = await openRaw(`ws://127.0.0.1:${port}`, {
      'x-role': 'mac',
      'x-session-id': 's4',
      origin: 'not-a-url',
    });
    assert.equal(result.ok, false, 'malformed Origin must be rejected');
    assert.equal(result.status, 403);
  } finally {
    await close();
  }
});

test('upgrade with Origin not in the explicit allowlist is rejected', async () => {
  const relay = new RelayServer({
    allowedOrigins: ['https://relay.example.com'],
  });
  const { port, close } = await relay.start(0, '127.0.0.1');
  try {
    const host = `127.0.0.1:${port}`;
    // Same-host Origin would pass the default check, but with an explicit
    // allowlist configured the Origin must be in the list.
    const result = await openRaw(`ws://${host}`, {
      'x-role': 'mac',
      'x-session-id': 's5',
      origin: `http://${host}`,
    });
    assert.equal(result.ok, false, 'Origin not in allowlist must be rejected');
    assert.equal(result.status, 403);
  } finally {
    await close();
  }
});

test('upgrade with Origin in the explicit allowlist is accepted', async () => {
  // A tunnel/proxy may set Host to an internal address while the public
  // Origin is the tunnel hostname. Allowlist mode is the operator's escape
  // hatch.
  const relay = new RelayServer({
    allowedOrigins: ['https://relay.example.com', 'http://localhost:9999'],
  });
  const { port, close } = await relay.start(0, '127.0.0.1');
  try {
    const result = await openRaw(`ws://127.0.0.1:${port}`, {
      'x-role': 'mac',
      'x-session-id': 's6',
      origin: 'https://relay.example.com',
    });
    assert.equal(result.ok, true, 'Origin in allowlist should be accepted');
    result.ws.close();
  } finally {
    await close();
  }
});

test('the /health endpoint is not subject to Origin checks (unrelated to CSWSH)', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
  } finally {
    await close();
  }
});

// Silence "unused" warnings on `once`/`WebSocket` imports that the type
// narrowing helpers rely on.
void once;
void WebSocket;
