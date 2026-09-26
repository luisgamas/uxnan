import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocatedAgent } from '@uxnan/shared';
import { AgentInstalls, REFRESH_TTL_MS } from '../../src/agents/agent-installs.js';
import { AgentManager } from '../../src/agents/agent-manager.js';
import { EchoAgentAdapter, ThreadStore, DaemonState, createLogger } from '../../src/index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
