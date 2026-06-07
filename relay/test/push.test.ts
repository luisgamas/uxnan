import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PushPlatform } from '@uxnan/shared';
import { PushRegistry, type PushPayload, type PushSender } from '../src/index.js';

const silentLogger = { info: () => {}, warn: () => {} };

class RecordingSender implements PushSender {
  readonly sent: { token: string; platform: PushPlatform; payload: PushPayload }[] = [];
  send(token: string, platform: PushPlatform, payload: PushPayload): Promise<void> {
    this.sent.push({ token, platform, payload });
    return Promise.resolve();
  }
}

function makeRegistry(sender: PushSender, secret = 'secret-1'): PushRegistry {
  return new PushRegistry({
    sender,
    logger: silentLogger,
    now: () => 1000,
    generateSecret: () => secret,
  });
}

test('register returns a stable secret and notify delivers to all session tokens', async () => {
  const sender = new RecordingSender();
  const registry = makeRegistry(sender);

  const reg = registry.register('ses_1', 'tokenA', 'android');
  assert.equal(reg.registered, true);
  assert.equal(reg.notificationSecret, 'secret-1');
  // a second token for the same session keeps the same secret
  assert.equal(registry.register('ses_1', 'tokenB', 'ios').notificationSecret, 'secret-1');

  const outcome = await registry.notify({
    sessionId: 'ses_1',
    notificationSecret: 'secret-1',
    threadId: 'th_1',
    turnId: 'tn_1',
    title: 'Done',
    body: 'Agent finished',
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.recipients, 2);
  assert.equal(sender.sent.length, 2);
  assert.equal(sender.sent[0]?.payload.title, 'Done');
  assert.deepEqual(sender.sent[0]?.payload.data, { threadId: 'th_1', turnId: 'tn_1' });
});

test('notify with a wrong secret is rejected and delivers nothing', async () => {
  const sender = new RecordingSender();
  const registry = makeRegistry(sender);
  registry.register('ses_1', 'tokenA', 'android');

  const outcome = await registry.notify({
    sessionId: 'ses_1',
    notificationSecret: 'WRONG',
    threadId: 'th_1',
    turnId: 'tn_1',
    title: 'x',
    body: 'y',
  });
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.reason, 'unauthorized');
  assert.equal(sender.sent.length, 0);
});

test('a duplicate (sessionId,turnId) within the window is suppressed', async () => {
  const sender = new RecordingSender();
  const registry = makeRegistry(sender);
  registry.register('ses_1', 'tokenA', 'android');
  const req = {
    sessionId: 'ses_1',
    notificationSecret: 'secret-1',
    threadId: 'th_1',
    turnId: 'tn_1',
    title: 'x',
    body: 'y',
  };
  assert.equal((await registry.notify(req)).delivered, true);
  const second = await registry.notify(req);
  assert.equal(second.delivered, false);
  assert.equal(second.reason, 'duplicate');
  assert.equal(sender.sent.length, 1);
});

test('notify for an unknown session is unauthorized', async () => {
  const registry = makeRegistry(new RecordingSender());
  const outcome = await registry.notify({
    sessionId: 'nope',
    notificationSecret: 'secret-1',
    threadId: 'th',
    turnId: 'tn',
    title: 'x',
    body: 'y',
  });
  assert.equal(outcome.reason, 'unauthorized');
});
