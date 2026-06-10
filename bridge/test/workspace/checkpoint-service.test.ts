import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { GitCommandError } from '../../src/index.js';
import { CheckpointService, DaemonState, runGit } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

async function newRepoWithCommit(): Promise<string> {
  const dir = join(tmpdir(), `uxnan-ckpt-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  await runGit(dir, ['init', '-b', 'main']);
  await runGit(dir, ['config', 'user.email', 'test@uxnan.dev']);
  await runGit(dir, ['config', 'user.name', 'Uxnan Test']);
  await runGit(dir, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(dir, 'tracked.txt'), 'v1\n');
  await runGit(dir, ['add', '-A']);
  await runGit(dir, ['commit', '-m', 'init']);
  return dir;
}

function newState(): DaemonState {
  return new DaemonState(join(tmpdir(), `uxnan-ckpt-state-${randomUUID()}`));
}

test('capture snapshots tracked changes and untracked files; diff lists them', async () => {
  const repo = await newRepoWithCommit();
  const service = new CheckpointService(newState());

  await writeFile(join(repo, 'tracked.txt'), 'v1\nv2\n'); // modify tracked
  await writeFile(join(repo, 'new.txt'), 'brand new\n'); // untracked

  const checkpoint = await service.capture(repo, { now: 1000, label: 'wip' });
  assert.match(checkpoint.id, /[0-9a-f-]{36}/);
  assert.equal(checkpoint.label, 'wip');

  const diff = await service.diff(checkpoint.id);
  const paths = diff.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['new.txt', 'tracked.txt']);
  assert.equal(diff.files.find((f) => f.path === 'new.txt')?.status, 'added');
  assert.ok(diff.diff.includes('brand new'));

  await rmrf(repo);
});

test('apply restores file contents captured by the checkpoint', async () => {
  const repo = await newRepoWithCommit();
  const service = new CheckpointService(newState());

  await writeFile(join(repo, 'tracked.txt'), 'checkpoint-state\n');
  const checkpoint = await service.capture(repo, { now: 1000 });

  // Diverge the working tree, then restore.
  await writeFile(join(repo, 'tracked.txt'), 'changed-after\n');
  await service.apply(checkpoint.id);

  assert.equal(await readFile(join(repo, 'tracked.txt'), 'utf-8'), 'checkpoint-state\n');
  await rmrf(repo);
});

test('apply deletes files created after the checkpoint and restores the rest', async () => {
  const repo = await newRepoWithCommit();
  const service = new CheckpointService(newState());

  await writeFile(join(repo, 'tracked.txt'), 'snap\n');
  const checkpoint = await service.capture(repo, { now: 1000 });

  // Diverge: modify a tracked file and add a brand-new untracked one.
  await writeFile(join(repo, 'tracked.txt'), 'after\n');
  await writeFile(join(repo, 'extra.txt'), 'created after the checkpoint\n');
  await service.apply(checkpoint.id);

  assert.equal(await readFile(join(repo, 'tracked.txt'), 'utf-8'), 'snap\n');
  // The post-checkpoint file is gone (true revert parity).
  await assert.rejects(readFile(join(repo, 'extra.txt'), 'utf-8'));
  await rmrf(repo);
});

test('apply recreates a file deleted after the checkpoint', async () => {
  const repo = await newRepoWithCommit();
  const service = new CheckpointService(newState());

  await writeFile(join(repo, 'keep.txt'), 'keep\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-m', 'add keep']);
  const checkpoint = await service.capture(repo, { now: 1000 });

  await rm(join(repo, 'keep.txt'), { force: true }); // delete after the checkpoint
  await service.apply(checkpoint.id);

  assert.equal(await readFile(join(repo, 'keep.txt'), 'utf-8'), 'keep\n');
  await rmrf(repo);
});

test('capture prunes checkpoints beyond the per-project cap (ref + metadata)', async () => {
  const repo = await newRepoWithCommit();
  const service = new CheckpointService(newState(), { maxPerProject: 2, ttlDays: 0 });

  await writeFile(join(repo, 'tracked.txt'), 'a\n');
  const c1 = await service.capture(repo, { now: 1000 });
  await writeFile(join(repo, 'tracked.txt'), 'b\n');
  const c2 = await service.capture(repo, { now: 2000 });
  await writeFile(join(repo, 'tracked.txt'), 'c\n');
  const c3 = await service.capture(repo, { now: 3000 });

  // The oldest (c1) is pruned: its ref is deleted and its metadata is gone.
  await assert.rejects(runGit(repo, ['rev-parse', '--verify', `refs/uxnan/checkpoints/${c1.id}`]));
  await assert.rejects(service.diff(c1.id));
  // The two newest survive (refs resolve, diff works).
  assert.ok(
    (
      await runGit(repo, ['rev-parse', '--verify', `refs/uxnan/checkpoints/${c2.id}`])
    ).stdout.trim(),
  );
  assert.ok(
    (
      await runGit(repo, ['rev-parse', '--verify', `refs/uxnan/checkpoints/${c3.id}`])
    ).stdout.trim(),
  );
  await rmrf(repo);
});

test('capture prunes checkpoints older than the TTL', async () => {
  const repo = await newRepoWithCommit();
  const service = new CheckpointService(newState(), { maxPerProject: 0, ttlDays: 1 });

  await writeFile(join(repo, 'tracked.txt'), 'old\n');
  const old = await service.capture(repo, { now: 0 });
  // A capture two days later prunes the day-0 checkpoint.
  await writeFile(join(repo, 'tracked.txt'), 'new\n');
  const fresh = await service.capture(repo, { now: 2 * 24 * 60 * 60 * 1000 });

  await assert.rejects(service.diff(old.id));
  assert.equal((await service.diff(fresh.id)).files.length >= 0, true);
  await rmrf(repo);
});

test('diff on an unknown checkpoint id is rejected', async () => {
  const service = new CheckpointService(newState());
  await assert.rejects(service.diff('does-not-exist'));
});

test('capture before the first commit fails (no HEAD)', async () => {
  const dir = join(tmpdir(), `uxnan-ckpt-empty-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  await runGit(dir, ['init', '-b', 'main']);
  const service = new CheckpointService(newState());
  await assert.rejects(service.capture(dir, { now: 1 }), GitCommandError);
  await rmrf(dir);
});
