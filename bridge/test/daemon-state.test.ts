import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { DaemonState, DEFAULT_DAEMON_CONFIG } from '../src/index.js';

function freshState(): DaemonState {
  return new DaemonState(join(tmpdir(), `uxnan-test-${randomUUID()}`));
}

test('readJson returns null for a missing file', async () => {
  const state = freshState();
  assert.equal(await state.readJson('nope.json'), null);
  await rm(state.baseDir, { recursive: true, force: true });
});

test('writeJson then readJson round-trips data', async () => {
  const state = freshState();
  await state.writeJson('thing.json', { a: 1, b: 'two' });
  assert.deepEqual(await state.readJson('thing.json'), { a: 1, b: 'two' });
  await rm(state.baseDir, { recursive: true, force: true });
});

test('readConfig returns defaults when no config exists', async () => {
  const state = freshState();
  assert.deepEqual(await state.readConfig(), DEFAULT_DAEMON_CONFIG);
  await rm(state.baseDir, { recursive: true, force: true });
});

test('initConfig writes defaults and merges a partial on next read', async () => {
  const state = freshState();
  const first = await state.initConfig();
  assert.deepEqual(first, DEFAULT_DAEMON_CONFIG);

  await state.writeJson('daemon-config.json', { lanPort: 20000 });
  const merged = await state.readConfig();
  assert.equal(merged.lanPort, 20000);
  assert.equal(merged.relayUrl, DEFAULT_DAEMON_CONFIG.relayUrl);
  await rm(state.baseDir, { recursive: true, force: true });
});
