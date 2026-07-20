import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { DaemonState, DEFAULT_DAEMON_CONFIG, renameWithRetry } from '../src/index.js';

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

test('initConfig does not freeze the seeded model lists to disk', async () => {
  const state = freshState();
  await state.initConfig();
  // The on-disk file must NOT carry the built-in agents/models — otherwise a
  // future app version could never add a model to an existing install.
  const onDisk = await state.readJson<Record<string, unknown>>('daemon-config.json');
  assert.equal(onDisk?.['agents'], undefined);
  // Yet the effective config still surfaces the live seed (Sonnet 5 included).
  const effective = await state.readConfig();
  const ids = (effective.agents['claude-code']?.models ?? []).map((m) =>
    typeof m === 'string' ? m : m.id,
  );
  assert.ok(ids.includes('claude-sonnet-5'));
  await rm(state.baseDir, { recursive: true, force: true });
});

test('renameWithRetry retries a transient EPERM and eventually succeeds', async () => {
  // `rename` over an existing file is intermittently refused on Windows (EPERM /
  // EBUSY / EACCES) when anything holds a momentary handle on the target —
  // antivirus, the Search indexer, a backup agent. Without a retry the error
  // propagated into `ThreadStore`, `AgentManager` swallowed it, and the turn was
  // left `streaming` forever (the long-standing "Windows CI flake").
  let calls = 0;
  await renameWithRetry('a', 'b', async () => {
    calls += 1;
    if (calls <= 3) {
      const err = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    }
  });
  assert.equal(calls, 4, 'it retried the refused renames rather than giving up');
});

test('renameWithRetry retries EBUSY and EACCES too', async () => {
  for (const code of ['EBUSY', 'EACCES']) {
    let calls = 0;
    await renameWithRetry('a', 'b', async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error(code) as NodeJS.ErrnoException;
        err.code = code;
        throw err;
      }
    });
    assert.equal(calls, 2, `${code} must be treated as transient`);
  }
});

test('renameWithRetry rethrows a non-transient error immediately', async () => {
  let calls = 0;
  await assert.rejects(
    renameWithRetry('a', 'b', async () => {
      calls += 1;
      const err = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    }),
    /ENOSPC/,
  );
  assert.equal(calls, 1, 'a real failure must not be retried');
});

test('renameWithRetry gives up after the backoff is exhausted', async () => {
  let calls = 0;
  await assert.rejects(
    renameWithRetry('a', 'b', async () => {
      calls += 1;
      const err = new Error('EPERM') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    }),
    /EPERM/,
  );
  // 5 backoff steps → 6 attempts, then the error surfaces rather than looping.
  assert.equal(calls, 6);
});

test('writeJson leaves no temp sibling when the rename ultimately fails', async () => {
  const state = freshState();
  await state.writeJson('threads.json', { v: 1 });
  // Point the state dir at a path whose rename target is a directory, so the
  // rename fails for a real, non-transient reason.
  await assert.rejects(state.writeJson('.', { v: 2 }));
  const { readdir } = await import('node:fs/promises');
  const left = (await readdir(state.baseDir)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(left, [], 'the temp file is cleaned up on failure');
  assert.deepEqual(await state.readJson('threads.json'), { v: 1 });
  await rm(state.baseDir, { recursive: true, force: true });
});
