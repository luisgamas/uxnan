import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcError } from '@uxnan/shared';
import { DaemonState, ProjectRegistry, projectIdFor } from '../../src/index.js';
import { SyncLedger } from '../../src/sync/sync-ledger.js';
import type { ProjectChange } from '../../src/projects/project-registry.js';

// The registry every client mirrors (architecture/02a §5.8.17): persistent,
// revisioned, announced, and keyed by the folder a project really is.

async function tempDir(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'uxnan-projects-')));
}

/** Folders are their own repository unless a test says otherwise. */
const noGit = async (dir: string): Promise<string> => dir;

test('config roots are registered on load, with stable ids and names', async () => {
  const registry = new ProjectRegistry({
    configRoots: ['/tmp/proj-a', '/tmp/proj-b'],
    repositoryRoot: noGit,
  });
  assert.equal(await registry.load(), true);
  const projects = registry.list();
  assert.deepEqual(
    projects.map((p) => p.name),
    ['proj-a', 'proj-b'],
  );
  assert.equal(projects[0]?.source, 'config');
  assert.ok(projects.every((p) => p.id === projectIdFor(p.cwd)));
});

test('add is idempotent, persisted, revisioned and announced', async () => {
  const base = await tempDir();
  try {
    const state = new DaemonState(join(base, 'state'));
    const ledger = await SyncLedger.load(state);
    const registry = new ProjectRegistry({ state, ledger, repositoryRoot: noGit });
    await registry.load();
    const changes: ProjectChange[] = [];
    registry.onChange((c) => changes.push(c));

    const folder = join(base, 'app');
    await mkdir(folder);
    const added = await registry.add(folder, { source: 'user' });
    const again = await registry.add(folder, { source: 'desktop', name: 'Other' });
    assert.equal(again.id, added.id);
    assert.equal(again.name, 'app', 'an existing entry keeps its name');
    assert.equal(changes.length, 1);
    assert.equal(added.rev, ledger.rev);

    // A fresh registry over the same state directory sees it.
    const reloaded = new ProjectRegistry({
      state,
      ledger: await SyncLedger.load(state),
      repositoryRoot: noGit,
    });
    assert.equal(await reloaded.load(), false);
    assert.equal(reloaded.byId(added.id).cwd, folder);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('remove leaves a tombstone; rename changes and restores the name', async () => {
  const ledger = SyncLedger.memory();
  const registry = new ProjectRegistry({ ledger, repositoryRoot: noGit });
  const project = await registry.add('/tmp/uxnan-some-app', { source: 'user' });
  const renamed = await registry.rename(project.id, 'My app');
  assert.equal(renamed.name, 'My app');
  assert.ok((renamed.rev ?? 0) > (project.rev ?? 0));
  assert.equal((await registry.rename(project.id, '')).name, 'uxnan-some-app');

  const before = ledger.rev;
  assert.equal(await registry.remove(project.id), true);
  assert.equal(await registry.remove(project.id), false);
  assert.deepEqual(ledger.deletedSince('project', before), [project.id]);
  assert.throws(() => registry.byId(project.id), RpcError);
  assert.equal(registry.changedSince(before).length, 0);
});

test('a worktree resolves to the project of its repository', async () => {
  const registry = new ProjectRegistry({
    // The registry resolves the folder first, so on Windows it arrives as `D:\wt\…`.
    repositoryRoot: async (dir) => (/[\\/]wt[\\/]/.test(dir) ? '/repos/app' : dir),
  });
  await registry.add('/repos/app', { source: 'desktop' });
  const project = await registry.resolve('/wt/app-feature');
  assert.equal(project.cwd, resolve('/repos/app'));
  assert.equal(project.source, 'desktop', 'it is the registered entry');

  const unknown = await registry.resolve('/elsewhere');
  assert.equal(unknown.source, undefined, 'a folder nobody added is not registered');
  assert.equal(unknown.id, projectIdFor('/elsewhere'));
});

test('a symlinked folder is the same project as its target', async () => {
  const base = await tempDir();
  try {
    const target = join(base, 'real');
    await mkdir(target);
    const { symlink } = await import('node:fs/promises');
    await symlink(target, join(base, 'link'));
    const registry = new ProjectRegistry({ repositoryRoot: noGit });
    const viaLink = await registry.add(join(base, 'link'), { source: 'user' });
    assert.equal(viaLink.cwd, target);
    assert.equal((await registry.resolve(target)).id, viaLink.id);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('per-project agent/model pin surfaces on the project and via agentConfigFor', async () => {
  const registry = new ProjectRegistry({
    configRoots: ['/tmp/proj-a', '/tmp/proj-b'],
    projectAgents: [{ agentId: 'codex', cwd: '/tmp/proj-a', model: 'gpt-5-codex' }],
    repositoryRoot: noGit,
  });
  await registry.load();
  const [a, b] = registry.list();
  assert.equal(a?.agentId, 'codex');
  assert.equal(a?.model, 'gpt-5-codex');
  assert.equal(b?.agentId, undefined);
  assert.equal(registry.agentConfigFor('/tmp/proj-a')?.agentId, 'codex');
  assert.equal(registry.agentConfigFor('/tmp/proj-b'), undefined);
});
