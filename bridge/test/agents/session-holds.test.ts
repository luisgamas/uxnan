/**
 * Which sessions a desktop terminal holds: taken and updated by the desktop
 * that holds them, gone with its connection, and let go on request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentSessionHold, AgentSessionKey } from '@uxnan/shared';
import { SessionHolds } from '../../src/agents/session-holds.js';

interface Asked extends AgentSessionKey {
  clientId: string;
  requestId: string;
  from: string;
}

function holds(options: { reachable?: boolean; answerTimeoutMs?: number } = {}) {
  let clock = 1_000;
  const changes: { key: AgentSessionKey; hold: AgentSessionHold | undefined }[] = [];
  const asked: Asked[] = [];
  const store = new SessionHolds({
    now: () => clock,
    holderName: () => 'Studio Mac',
    onChange: (key, hold) => changes.push({ key: { ...key }, hold }),
    askHolder: (clientId, request) => {
      asked.push({ clientId, ...request });
      return options.reachable ?? true;
    },
    ...(options.answerTimeoutMs !== undefined ? { answerTimeoutMs: options.answerTimeoutMs } : {}),
  });
  return {
    store,
    changes,
    asked,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const KEY = { agentId: 'claude-code', sessionId: 's-1' } as const;

test('a hold names its terminal, how long ago it was taken, and whether the agent works', () => {
  const { store, changes, advance } = holds();
  const taken = store.hold('desktop', { ...KEY, cwd: '/p' });
  assert.deepEqual(taken, {
    ...KEY,
    cwd: '/p',
    holder: { kind: 'terminal', name: 'Studio Mac' },
    heldAgoMs: 0,
    busy: false,
  });
  advance(5_000);
  assert.equal(store.find(KEY.agentId, KEY.sessionId)?.heldAgoMs, 5_000);
  assert.equal(changes.length, 1);

  // The same call again changes nothing; the agent starting to work does.
  store.hold('desktop', { ...KEY, cwd: '/p' });
  assert.equal(changes.length, 1);
  store.hold('desktop', { ...KEY, busy: true });
  assert.equal(changes.length, 2);
  assert.equal(changes[1]!.hold?.busy, true);
  // A hold keeps the time it was first taken, and its folder.
  assert.equal(changes[1]!.hold?.heldAgoMs, 5_000);
  assert.equal(changes[1]!.hold?.cwd, '/p');
});

test('only the desktop that holds a session lets it go; its disconnect lets all of them go', () => {
  const { store, changes } = holds();
  store.hold('desktop', KEY);
  store.hold('desktop', { agentId: 'codex', sessionId: 'c-1' });
  store.hold('other-desktop', { agentId: 'pi-agent', sessionId: 'p-1' });

  store.release('other-desktop', KEY);
  assert.ok(store.find(KEY.agentId, KEY.sessionId));
  store.release('desktop', KEY);
  assert.equal(store.find(KEY.agentId, KEY.sessionId), undefined);
  assert.deepEqual(changes.at(-1), { key: KEY, hold: undefined });

  store.releaseAll('desktop');
  assert.deepEqual(
    store.list().map((h) => h.sessionId),
    ['p-1'],
  );
});

test('a conversation that continues a held session is named on the hold', () => {
  const { store, changes } = holds();
  store.hold('desktop', KEY);
  store.attachThread(KEY, 'thread-9');
  assert.equal(store.find(KEY.agentId, KEY.sessionId)?.threadId, 'thread-9');
  assert.equal(changes.at(-1)?.hold?.threadId, 'thread-9');
  // Nothing to name on a session no terminal holds.
  store.attachThread({ agentId: 'codex', sessionId: 'free' }, 'thread-1');
  assert.equal(store.find('codex', 'free'), undefined);
});

test('asking for a session: free, busy, or asked of its holder and let go', async () => {
  const { store, asked } = holds();
  assert.equal(await store.requestHandoff(KEY, 'Pixel'), 'notHeld');

  store.hold('desktop', { ...KEY, busy: true });
  assert.equal(await store.requestHandoff(KEY, 'Pixel'), 'busy');
  assert.equal(asked.length, 0);

  store.hold('desktop', { ...KEY, busy: false });
  const pending = store.requestHandoff(KEY, 'Pixel');
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.clientId, 'desktop');
  assert.equal(asked[0]!.from, 'Pixel');
  // Only the holder's answer counts.
  store.answer('other-desktop', asked[0]!.requestId, 'released');
  store.answer('desktop', asked[0]!.requestId, 'released');
  assert.equal(await pending, 'released');
  // A released session is free at once, even if the desktop had not said so.
  assert.equal(store.find(KEY.agentId, KEY.sessionId), undefined);
});

test('a holder that declines keeps the session', async () => {
  const { store, asked } = holds();
  store.hold('desktop', KEY);
  const pending = store.requestHandoff(KEY, 'Pixel');
  store.answer('desktop', asked[0]!.requestId, 'declined');
  assert.equal(await pending, 'declined');
  assert.ok(store.find(KEY.agentId, KEY.sessionId));
});

test('a holder that cannot be reached, never answers, or leaves is unreachable', async () => {
  const unreachable = holds({ reachable: false });
  unreachable.store.hold('desktop', KEY);
  assert.equal(await unreachable.store.requestHandoff(KEY, 'Pixel'), 'unreachable');

  const silent = holds({ answerTimeoutMs: 20 });
  silent.store.hold('desktop', KEY);
  assert.equal(await silent.store.requestHandoff(KEY, 'Pixel'), 'unreachable');

  const leaving = holds();
  leaving.store.hold('desktop', KEY);
  const pending = leaving.store.requestHandoff(KEY, 'Pixel');
  leaving.store.releaseAll('desktop');
  assert.equal(await pending, 'unreachable');
});
