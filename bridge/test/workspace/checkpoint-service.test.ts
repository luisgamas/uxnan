import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
