import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  PushService,
  DaemonState,
  createLogger,
  DEFAULT_DAEMON_CONFIG,
  type PushSender,
  type PushPayload,
} from '../../src/index.js';
import type { PushPlatform } from '@uxnan/shared';

interface Call {
  url: string;
  body: Record<string, unknown>;
}

interface SentPush {
  token: string;
  platform: PushPlatform;
  payload: PushPayload;
}

/** A fake direct-FCM sender that records every delivery. */
function fakeSender(sent: SentPush[]): PushSender {
  return {
    send(token, platform, payload) {
      sent.push({ token, platform, payload });
      return Promise.resolve();
    },
  };
}

function fakeFetch(calls: Call[], registerSecret = 'sec-1') {
  return (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith('/push/register')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ registered: true, notificationSecret: registerSecret }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ delivered: true }),
    });
  };
}

interface ServiceOpts {
  state?: DaemonState;
  sender?: PushSender;
  relayEnabled?: boolean;
}

function service(calls: Call[], opts: ServiceOpts = {}) {
  const config = opts.relayEnabled
    ? { ...DEFAULT_DAEMON_CONFIG, relayEnabled: true }
    : DEFAULT_DAEMON_CONFIG;
  return new PushService({
    relayUrl: 'wss://relay.example/ws',
    config,
    logger: createLogger('test', 'error'),
    fetchFn: fakeFetch(calls) as never,
    ...(opts.state ? { state: opts.state } : {}),
    ...(opts.sender ? { pushSender: opts.sender } : {}),
  });
}

test('register forwards the token to the relay over http(s)', async () => {
  const calls: Call[] = [];
  const svc = service(calls);
  svc.setActiveSession('ses_1');
  const res = await svc.register('tok', 'android');
  assert.equal(res.registered, true);
  assert.equal(calls[0]?.url, 'https://relay.example/push/register');
  assert.deepEqual(calls[0]?.body, { sessionId: 'ses_1', pushToken: 'tok', platform: 'android' });
});

test('register without an active session is a no-op', async () => {
  const calls: Call[] = [];
  const svc = service(calls);
  const res = await svc.register('tok', 'ios');
  assert.equal(res.registered, false);
  assert.equal(calls.length, 0);
});

test('onTurnEnd pushes a completed notification once registered', async () => {
  const calls: Call[] = [];
  const svc = service(calls);
  svc.setActiveSession('ses_1');
  await svc.register('tok', 'android');

  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'all done' });
  // onTurnEnd is fire-and-forget; let the microtask flush.
  await new Promise((r) => setTimeout(r, 10));

  const notify = calls.find((c) => c.url.endsWith('/push/notify'));
  assert.ok(notify, 'expected a /push/notify call');
  assert.equal(notify?.body['sessionId'], 'ses_1');
  assert.equal(notify?.body['notificationSecret'], 'sec-1');
  assert.equal(notify?.body['title'], 'Turn completed');
  assert.equal(notify?.body['body'], 'all done');
});

test('onTurnEnd does nothing without a registration', async () => {
  const calls: Call[] = [];
  const svc = service(calls);
  svc.setActiveSession('ses_1');
  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'x' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 0);
});

test('onTurnEnd pushes to every registered session (multi-device)', async () => {
  const calls: Call[] = [];
  const svc = service(calls);
  svc.setActiveSession('ses_1');
  await svc.register('tok-1', 'android');
  svc.setActiveSession('ses_2');
  await svc.register('tok-2', 'ios');

  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
  await new Promise((r) => setTimeout(r, 10));

  const notified = calls
    .filter((c) => c.url.endsWith('/push/notify'))
    .map((c) => c.body['sessionId']);
  assert.deepEqual(notified.sort(), ['ses_1', 'ses_2']);
});

test('unregister removes only the active session', async () => {
  const calls: Call[] = [];
  const svc = service(calls);
  svc.setActiveSession('ses_1');
  await svc.register('tok-1', 'android');
  svc.setActiveSession('ses_2');
  await svc.register('tok-2', 'ios');

  // The active session is ses_2; unregister it, ses_1 must still be notified.
  svc.unregister();
  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
  await new Promise((r) => setTimeout(r, 10));

  const notified = calls
    .filter((c) => c.url.endsWith('/push/notify'))
    .map((c) => c.body['sessionId']);
  assert.deepEqual(notified, ['ses_1']);
});

test('registrations persist across a restart via push-state.json', async () => {
  const baseDir = join(tmpdir(), `uxnan-push-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  try {
    const calls1: Call[] = [];
    const svc1 = service(calls1, { state });
    svc1.setActiveSession('ses_1');
    await svc1.register('tok-1', 'android');

    // A fresh service (simulating a bridge restart) loads the persisted state and
    // can push WITHOUT the phone re-registering.
    const calls2: Call[] = [];
    const svc2 = service(calls2, { state });
    await svc2.load();
    svc2.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
    await new Promise((r) => setTimeout(r, 10));

    const notify = calls2.find((c) => c.url.endsWith('/push/notify'));
    assert.ok(notify, 'expected a /push/notify after reload');
    assert.equal(notify?.body['sessionId'], 'ses_1');
    assert.equal(notify?.body['notificationSecret'], 'sec-1');
    assert.equal(
      calls2.some((c) => c.url.endsWith('/push/register')),
      false,
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

// --- Direct FCM path (PRIMARY) -------------------------------------------------

test('direct sender: register does NOT touch the relay (relay off, default)', async () => {
  const calls: Call[] = [];
  const sent: SentPush[] = [];
  const svc = service(calls, { sender: fakeSender(sent) });
  svc.setActiveSession('ses_1');
  const res = await svc.register('fcm-tok', 'android');
  assert.equal(res.registered, true);
  // No /push/register — direct FCM is the path, relay is disabled by default.
  assert.equal(calls.length, 0);
  assert.equal(svc.directPushAvailable, true);
});

test('direct sender: onTurnEnd delivers via FCM, not the relay', async () => {
  const calls: Call[] = [];
  const sent: SentPush[] = [];
  const svc = service(calls, { sender: fakeSender(sent) });
  svc.setActiveSession('ses_1');
  await svc.register('fcm-tok', 'android');

  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'all done' });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(calls.length, 0, 'must not call the relay when delivering directly');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.token, 'fcm-tok');
  assert.equal(sent[0]?.platform, 'android');
  assert.equal(sent[0]?.payload.title, 'Turn completed');
  assert.equal(sent[0]?.payload.body, 'all done');
  assert.deepEqual(sent[0]?.payload.data, { threadId: 'th', turnId: 'tn' });
});

test('direct sender: registration survives a restart and pushes via FCM after reload', async () => {
  const baseDir = join(tmpdir(), `uxnan-push-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  try {
    const svc1 = service([], { state, sender: fakeSender([]) });
    svc1.setActiveSession('ses_1');
    await svc1.register('fcm-tok', 'ios');

    const sent: SentPush[] = [];
    const svc2 = service([], { state, sender: fakeSender(sent) });
    await svc2.load();
    svc2.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(sent.length, 1, 'expected a direct FCM delivery after reload');
    assert.equal(sent[0]?.token, 'fcm-tok');
    assert.equal(sent[0]?.platform, 'ios');
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('direct sender + relay enabled: registers with relay too, but notifies via FCM', async () => {
  const calls: Call[] = [];
  const sent: SentPush[] = [];
  const svc = service(calls, { sender: fakeSender(sent), relayEnabled: true });
  svc.setActiveSession('ses_1');
  await svc.register('fcm-tok', 'android');
  // Relay registration still happens (fallback secret kept) when relay is enabled.
  assert.ok(
    calls.some((c) => c.url.endsWith('/push/register')),
    'expected a relay register when relayEnabled',
  );

  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
  await new Promise((r) => setTimeout(r, 10));
  // Delivery is direct; the relay /push/notify must NOT be used.
  assert.equal(
    calls.some((c) => c.url.endsWith('/push/notify')),
    false,
  );
  assert.equal(sent.length, 1);
});
