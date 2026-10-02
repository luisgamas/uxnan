import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PushService,
  DaemonState,
  createLogger,
  DEFAULT_DAEMON_CONFIG,
  type PushSender,
  type PushPayload,
} from '../../src/index.js';
import type { PushPlatform } from '@uxnan/shared';
import { rmrf } from '../helpers/fs.js';

interface SentPush {
  token: string;
  platform: PushPlatform;
  payload: PushPayload;
}

/** A fake FCM sender that records every delivery. */
function fakeSender(sent: SentPush[]): PushSender {
  return {
    send(token, platform, payload) {
      sent.push({ token, platform, payload });
      return Promise.resolve();
    },
  };
}

interface ServiceOpts {
  state?: DaemonState;
  sender?: PushSender;
}

function service(opts: ServiceOpts = {}) {
  return new PushService({
    config: DEFAULT_DAEMON_CONFIG,
    logger: createLogger('test', 'error'),
    ...(opts.state ? { state: opts.state } : {}),
    ...(opts.sender ? { pushSender: opts.sender } : {}),
  });
}

/** Register a token for an explicit session (+ optional device id). */
function reg(
  svc: PushService,
  sessionId: string,
  pushToken: string,
  platform: 'android' | 'ios',
  deviceId?: string,
) {
  return svc.register({
    sessionId,
    pushToken,
    platform,
    ...(deviceId !== undefined ? { deviceId } : {}),
  });
}

/** onTurnEnd is fire-and-forget; let its microtasks flush. */
const flush = () => new Promise((r) => setTimeout(r, 10));

/**
 * Run `body` with `globalThis.fetch` replaced by a recorder, so a test can prove
 * the push service never sends the phone's token anywhere but the FCM sender.
 */
async function withFetchSpy(body: (urls: string[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: unknown) => {
    urls.push(String(input));
    return Promise.reject(new Error('unexpected network call'));
  }) as typeof fetch;
  try {
    await body(urls);
  } finally {
    globalThis.fetch = original;
  }
}

test('register stores the token and reports delivery when an FCM sender exists', async () => {
  const svc = service({ sender: fakeSender([]) });
  const res = await reg(svc, 'ses_1', 'fcm-tok', 'android');
  assert.equal(res.registered, true);
  assert.equal(svc.directPushAvailable, true);
});

test('register without an FCM sender reports no delivery path', async () => {
  const svc = service();
  const res = await reg(svc, 'ses_1', 'fcm-tok', 'android');
  assert.equal(res.registered, false);
  assert.equal(svc.directPushAvailable, false);
});

test('the phone token never leaves the bridge: no network call on register or turn end', async () => {
  await withFetchSpy(async (urls) => {
    // With no FCM credential (the case that used to fall back to a relay) …
    const bare = service();
    await reg(bare, 'ses_1', 'fcm-tok', 'android');
    bare.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
    // … and with one, where delivery goes through the injected sender only.
    const withSender = service({ sender: fakeSender([]) });
    await reg(withSender, 'ses_2', 'fcm-tok-2', 'ios');
    withSender.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
    await flush();
    assert.deepEqual(urls, []);
  });
});

test('onTurnEnd delivers a completed notification via FCM', async () => {
  const sent: SentPush[] = [];
  const svc = service({ sender: fakeSender(sent) });
  await reg(svc, 'ses_1', 'fcm-tok', 'android');

  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'all done' });
  await flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.token, 'fcm-tok');
  assert.equal(sent[0]?.platform, 'android');
  assert.equal(sent[0]?.payload.title, 'Turn completed');
  assert.equal(sent[0]?.payload.body, 'all done');
  assert.deepEqual(sent[0]?.payload.data, { threadId: 'th', turnId: 'tn' });
});

test('onTurnEnd delivers an error notification via FCM', async () => {
  const sent: SentPush[] = [];
  const svc = service({ sender: fakeSender(sent) });
  await reg(svc, 'ses_1', 'fcm-tok', 'ios');

  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'error', text: 'boom' });
  await flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.payload.title, 'Turn failed');
  assert.equal(sent[0]?.payload.body, 'boom');
});

test('onTurnEnd does nothing without a registration', async () => {
  const sent: SentPush[] = [];
  const svc = service({ sender: fakeSender(sent) });
  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'x' });
  await flush();
  assert.equal(sent.length, 0);
});

test('onTurnEnd pushes to every registered session (multi-device)', async () => {
  const sent: SentPush[] = [];
  const svc = service({ sender: fakeSender(sent) });
  await reg(svc, 'ses_1', 'tok-1', 'android');
  await reg(svc, 'ses_2', 'tok-2', 'ios');

  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
  await flush();

  assert.deepEqual(sent.map((s) => s.token).sort(), ['tok-1', 'tok-2']);
});

test('unregister(sessionId) removes only that session', async () => {
  const sent: SentPush[] = [];
  const svc = service({ sender: fakeSender(sent) });
  await reg(svc, 'ses_1', 'tok-1', 'android');
  await reg(svc, 'ses_2', 'tok-2', 'ios');

  svc.unregister('ses_2');
  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
  await flush();

  assert.deepEqual(
    sent.map((s) => s.token),
    ['tok-1'],
  );
});

test('unregisterDevice prunes every registration owned by a removed device', async () => {
  const sent: SentPush[] = [];
  const svc = service({ sender: fakeSender(sent) });
  // Two sessions for the same phone (device-a) + one for another phone (device-b).
  await reg(svc, 'ses_1', 'tok-1', 'android', 'device-a');
  await reg(svc, 'ses_2', 'tok-2', 'android', 'device-a');
  await reg(svc, 'ses_3', 'tok-3', 'ios', 'device-b');

  const removed = svc.unregisterDevice('device-a');
  assert.equal(removed, 2);

  svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
  await flush();
  assert.deepEqual(
    sent.map((s) => s.token),
    ['tok-3'],
    'only the other device still receives push',
  );
});

test('a registration survives a restart and pushes via FCM after reload', async () => {
  const baseDir = join(tmpdir(), `uxnan-push-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  try {
    const svc1 = service({ state, sender: fakeSender([]) });
    await reg(svc1, 'ses_1', 'fcm-tok', 'ios');

    // A fresh service (simulating a bridge restart) loads the persisted state and
    // can push WITHOUT the phone re-registering.
    const sent: SentPush[] = [];
    const svc2 = service({ state, sender: fakeSender(sent) });
    await svc2.load();
    svc2.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
    await flush();

    assert.equal(sent.length, 1, 'expected an FCM delivery after reload');
    assert.equal(sent[0]?.token, 'fcm-tok');
    assert.equal(sent[0]?.platform, 'ios');
  } finally {
    await rmrf(baseDir);
  }
});

test('load drops persisted entries without a device token', async () => {
  const baseDir = join(tmpdir(), `uxnan-push-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  try {
    // The shape a bridge wrote while it still registered phones with a relay.
    await state.writeJson('push-state.json', {
      version: 1,
      registrations: [
        {
          sessionId: 'ses_old',
          notificationSecret: 'sec',
          preferences: { turnCompleted: true, turnError: true },
        },
      ],
    });
    const sent: SentPush[] = [];
    const svc = service({ state, sender: fakeSender(sent) });
    await svc.load();
    svc.onTurnEnd({ threadId: 'th', turnId: 'tn', status: 'completed', text: 'done' });
    await flush();
    assert.equal(sent.length, 0);
  } finally {
    await rmrf(baseDir);
  }
});
