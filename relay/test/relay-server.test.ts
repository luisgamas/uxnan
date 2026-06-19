import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { RelayServer } from '../src/index.js';

async function connect(url: string, role: string, sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers: { 'x-role': role, 'x-session-id': sessionId } });
  await once(ws, 'open');
  return ws;
}

test('the relay forwards frames both ways between paired peers', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  const url = `ws://127.0.0.1:${port}`;
  const sessionId = 'sess-forward';

  const mac = await connect(url, 'mac', sessionId);
  const iphone = await connect(url, 'iphone', sessionId);

  const macGot = once(mac, 'message').then(([d]) => (d as Buffer).toString());
  iphone.send(Buffer.from('phone→bridge'), { binary: true });
  assert.equal(await macGot, 'phone→bridge');

  const phoneGot = once(iphone, 'message').then(([d]) => (d as Buffer).toString());
  mac.send(Buffer.from('bridge→phone'), { binary: true });
  assert.equal(await phoneGot, 'bridge→phone');

  assert.equal(relay.sessionCount, 1);
  mac.close();
  iphone.close();
  await close();
});

test('closing one peer also closes the paired peer', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  const url = `ws://127.0.0.1:${port}`;
  const sessionId = 'sess-peer-close';

  const mac = await connect(url, 'mac', sessionId);
  const iphone = await connect(url, 'iphone', sessionId);

  const phoneClosed = once(iphone, 'close');
  mac.close(); // bridge drops; the phone must learn the session is gone
  await phoneClosed;
  assert.equal(iphone.readyState, WebSocket.CLOSED);
  await close();
});

test('a reconnecting phone supersedes its stale socket and re-arms the bridge', async () => {
  // Regression: when the phone reconnects after a background drop, its old
  // half-open socket never delivered a close, so a new `iphone` socket joins
  // while the old one still lingers. The relay must close the superseded socket
  // AND tear down the paired `mac` so the bridge re-arms a fresh handshake —
  // otherwise the bridge keeps serving the dead session and the phone is stuck
  // "reconnecting" forever (only fixed by force-killing the app).
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  const url = `ws://127.0.0.1:${port}`;
  const sessionId = 'sess-supersede';

  const mac = await connect(url, 'mac', sessionId);
  const staleIphone = await connect(url, 'iphone', sessionId);

  // The bridge's `mac` socket must close so its serve loop re-arms, and the
  // stale phone socket must be cleaned up.
  const macClosed = once(mac, 'close');
  const staleClosed = once(staleIphone, 'close');

  // The phone reconnects (a brand-new socket) before the old one ever closed.
  const freshIphone = await connect(url, 'iphone', sessionId);

  await macClosed;
  await staleClosed;
  assert.equal(mac.readyState, WebSocket.CLOSED);
  assert.equal(staleIphone.readyState, WebSocket.CLOSED);

  // The fresh phone socket survives and is the live one for the session.
  assert.equal(freshIphone.readyState, WebSocket.OPEN);

  freshIphone.close();
  await close();
});

test('a connection without a role/sessionId is rejected', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await assert.rejects(once(ws, 'open'));
  await close();
});

test('GET /health returns ok', async () => {
  const relay = new RelayServer();
  const { port, close } = await relay.start(0, '127.0.0.1');
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  await close();
});

test('HTTP requests over the per-IP rate limit get 429', async () => {
  const relay = new RelayServer({ rateLimits: { httpPerMinute: 2 } });
  const { port, close } = await relay.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}/health`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url)).status, 429);
  await close();
});
