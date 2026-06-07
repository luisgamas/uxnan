import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PushService, createLogger, DEFAULT_DAEMON_CONFIG } from '../../src/index.js';

interface Call {
  url: string;
  body: Record<string, unknown>;
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

function service(calls: Call[]) {
  return new PushService({
    relayUrl: 'wss://relay.example/ws',
    config: DEFAULT_DAEMON_CONFIG,
    logger: createLogger('test', 'error'),
    fetchFn: fakeFetch(calls) as never,
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
