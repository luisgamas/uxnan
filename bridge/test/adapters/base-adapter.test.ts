/**
 * The one conversation → native session map every adapter shares: adopting a
 * stored id, keeping a live one, and never taking back an id the CLI refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentCapabilities } from '@uxnan/shared';
import { BaseAgentAdapter } from '../../src/adapters/base-adapter.js';

class SessionAdapter extends BaseAgentAdapter {
  readonly agentId = 'echo' as const;
  readonly capabilities = {} as AgentCapabilities;
  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  sendTurn(): Promise<void> {
    return Promise.resolve();
  }
  cancelTurn(): Promise<void> {
    return Promise.resolve();
  }
  /** What a CLI announcing its session looks like to the adapter. */
  announce(threadId: string, sessionId: string): void {
    this.setNativeSession(threadId, sessionId);
  }
  /** What a CLI failing to resume looks like to the adapter. */
  refuse(threadId: string): void {
    this.refuseNativeSession(threadId);
  }
}

test('an adopted session is the one the conversation continues in', () => {
  const adapter = new SessionAdapter();
  assert.equal(adapter.nativeSessionId('t'), undefined);
  adapter.adoptNativeSession('t', 's-stored');
  assert.equal(adapter.nativeSessionId('t'), 's-stored');
  // Empty ids are not sessions.
  adapter.adoptNativeSession('u', '');
  assert.equal(adapter.nativeSessionId('u'), undefined);
});

test('adopting never replaces the session the adapter already holds', () => {
  const adapter = new SessionAdapter();
  adapter.announce('t', 's-live');
  adapter.adoptNativeSession('t', 's-other');
  assert.equal(adapter.nativeSessionId('t'), 's-live');
});

test('a refused session is forgotten and never adopted again for that thread', () => {
  const adapter = new SessionAdapter();
  adapter.adoptNativeSession('t', 's-gone');
  adapter.refuse('t');
  assert.equal(adapter.nativeSessionId('t'), undefined);

  // The store still holds the gone id until the fresh session is persisted.
  adapter.adoptNativeSession('t', 's-gone');
  assert.equal(adapter.nativeSessionId('t'), undefined);
  // Another thread may still adopt it, and this one may adopt a different id.
  adapter.adoptNativeSession('u', 's-gone');
  assert.equal(adapter.nativeSessionId('u'), 's-gone');
  adapter.adoptNativeSession('t', 's-next');
  assert.equal(adapter.nativeSessionId('t'), 's-next');
});

test('a session the CLI announces clears an earlier refusal', () => {
  const adapter = new SessionAdapter();
  adapter.announce('t', 's-1');
  adapter.refuse('t');
  adapter.announce('t', 's-1');
  assert.equal(adapter.nativeSessionId('t'), 's-1');
  adapter.refuse('t');
  assert.equal(adapter.nativeSessionId('t'), undefined);
  // Refusing a thread with no session is a no-op.
  adapter.refuse('none');
  adapter.adoptNativeSession('none', 's-x');
  assert.equal(adapter.nativeSessionId('none'), 's-x');
});
