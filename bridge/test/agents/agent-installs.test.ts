import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocatedAgent } from '@uxnan/shared';
import { StreamNotification } from '@uxnan/shared';
import { AgentInstalls, REFRESH_TTL_MS } from '../../src/agents/agent-installs.js';
import { AgentManager } from '../../src/agents/agent-manager.js';
import { EchoAgentAdapter, ThreadStore, DaemonState, createLogger } from '../../src/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmrf } from '../helpers/fs.js';

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 10000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

// An agent installed while the bridge runs appears without a restart, built
// where it was actually found.

test('availability is re-checked while running, and a newly installed agent gets a fresh adapter', () => {
  let now = 0;
  let installed = false;
  const located = (): LocatedAgent => ({
    binaryPath: installed ? '/usr/local/bin/node' : 'echo',
    prependArgs: installed ? ['/usr/local/lib/node_modules/x/cli.js'] : [],
    available: installed,
    checked: ['PATH:/usr/bin'],
  });
  const manager = new AgentManager({
    store: new ThreadStore(new DaemonState(join(tmpdir(), 'uxnan-installs-unused'))),
    notify: () => undefined,
    now: () => now,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const installs = new AgentInstalls(manager, { locate: located, now: () => now });
  const built: LocatedAgent[] = [];
  const available: LocatedAgent[] = [];
  let changes = 0;
  installs.onChange(() => changes++);
  installs.register({
    agentId: 'echo',
    displayName: 'Echo',
    create: (l) => {
      built.push(l);
      return new EchoAgentAdapter();
    },
    whenAvailable: (l) => available.push(l),
  });
  assert.equal(manager.isAvailable('echo'), false);
  assert.equal(available.length, 0);

  installed = true;
  assert.equal(installs.refresh(), false, 'inside the TTL nothing is re-checked');
  now += REFRESH_TTL_MS;
  assert.equal(installs.refresh(), true);
  assert.equal(manager.isAvailable('echo'), true);
  assert.equal(built.length, 2, 'rebuilt where it was found');
  assert.deepEqual(built[1]?.prependArgs, ['/usr/local/lib/node_modules/x/cli.js']);
  assert.equal(available.length, 1);
  assert.equal(changes, 1);

  installed = false;
  assert.equal(installs.refresh(true), true);
  assert.equal(manager.isAvailable('echo'), false);
  assert.deepEqual(installs.diagnose(), [
    { agentId: 'echo', available: false, checked: ['PATH:/usr/bin'] },
  ]);
});

// A CLI that moves (npm global → `~/.local/bin`) must not leave an adapter
// spawning the path that is gone.

test('a CLI that moved is rebuilt where it is now, announced only if availability changed', () => {
  let now = 0;
  let path = '/usr/local/bin/echo';
  const located = (): LocatedAgent => ({
    binaryPath: path,
    prependArgs: [],
    available: true,
    checked: ['PATH:/usr/bin'],
  });
  const manager = new AgentManager({
    store: new ThreadStore(new DaemonState(join(tmpdir(), 'uxnan-installs-moved'))),
    notify: () => undefined,
    now: () => now,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const installs = new AgentInstalls(manager, { locate: located, now: () => now });
  const built: LocatedAgent[] = [];
  const stopped: number[] = [];
  let changes = 0;
  installs.onChange(() => changes++);
  installs.register({
    agentId: 'echo',
    displayName: 'Echo',
    create: (l) => {
      const n = built.push(l);
      const adapter = new EchoAgentAdapter();
      adapter.stop = () => {
        stopped.push(n);
        return Promise.resolve();
      };
      return adapter;
    },
  });
  assert.equal(built.length, 1);
  assert.equal(built[0]?.binaryPath, path);

  path = '/Users/me/.local/bin/echo';
  now += REFRESH_TTL_MS;
  assert.equal(installs.refresh(), false, 'a move is not an availability change');
  assert.equal(built.length, 2, 'the adapter was built again where the CLI is');
  assert.equal(built[1]?.binaryPath, path);
  assert.equal(
    installs.located('echo')?.binaryPath,
    path,
    'what is recorded is what the registered adapter was built with',
  );
  assert.equal(manager.isAvailable('echo'), true);
  assert.equal(changes, 0, 'the agent list did not change, so nothing is announced');
  assert.deepEqual(stopped, [1], 'the replaced adapter let go of what it held');
});

test('a move waits for a running turn, and the next refresh applies it', async () => {
  let now = 1000;
  let path = '/usr/local/bin/echo';
  const located = (): LocatedAgent => ({
    binaryPath: path,
    prependArgs: [],
    available: true,
    checked: ['PATH:/usr/bin'],
  });
  const baseDir = join(tmpdir(), `uxnan-installs-busy-${randomUUID()}`);
  const store = new ThreadStore(new DaemonState(baseDir));
  const notifications: { method: string }[] = [];
  const manager = new AgentManager({
    store,
    notify: (message) => notifications.push(message as { method: string }),
    now: () => now,
    logger: createLogger('test', 'error'),
    defaultAgent: 'echo',
  });
  const installs = new AgentInstalls(manager, { locate: located, now: () => now });
  const built: LocatedAgent[] = [];
  let changes = 0;
  installs.onChange(() => changes++);
  installs.register({
    agentId: 'echo',
    displayName: 'Echo',
    create: (l) => {
      built.push(l);
      return new EchoAgentAdapter();
    },
  });

  // The demo approval pauses the turn: the agent now has active work.
  const thread = await store.startThread({ projectId: 'p' }, 1);
  const { turnId } = await manager.sendTurn(thread.id, 'approval-demo');
  await waitFor(() => notifications.some((n) => n.method === StreamNotification.ContentBlock));
  assert.equal(manager.hasActiveWork('echo'), true);

  path = '/Users/me/.local/bin/echo';
  now += REFRESH_TTL_MS;
  assert.equal(installs.refresh(), false, 'a move is never an availability change');
  assert.equal(built.length, 1, 'the adapter running a turn is never swapped');
  assert.equal(
    installs.located('echo')?.binaryPath,
    '/usr/local/bin/echo',
    'what is recorded stays what the running adapter was built with — so the next refresh retries',
  );

  // Turn over → the same move is picked up on the next refresh.
  await manager.respondApproval(thread.id, `appr-${turnId}`, 'approve');
  await waitFor(async () => (await store.getTurn(turnId)).status === 'completed');
  now += REFRESH_TTL_MS;
  assert.equal(installs.refresh(), false);
  assert.equal(built.length, 2, 'rebuilt once the turn was done');
  assert.equal(built[1]?.binaryPath, path);
  assert.equal(installs.located('echo')?.binaryPath, path);
  assert.equal(changes, 0, 'no availability changed, so nothing was ever announced');
  await rmrf(baseDir);
});
