import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrowseService, browseRootIdFor } from '../../src/index.js';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';

async function makeTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-browse-'));
  await mkdir(join(root, 'alpha', 'nested'), { recursive: true });
  await mkdir(join(root, 'beta', '.git'), { recursive: true }); // beta is a git repo
  await mkdir(join(root, '.git'), { recursive: true }); // must be excluded
  await writeFile(join(root, 'readme.txt'), 'hi'); // a file, not a dir
  await writeFile(join(root, '.env'), 'SECRET=1'); // sensitive (also a file)
  return root;
}

test('listRoots reports the configured roots with stable ids', async () => {
  const root = await makeTree();
  try {
    const svc = new BrowseService([root]);
    const roots = svc.listRoots();
    assert.equal(roots.length, 1);
    assert.equal(roots[0]!.cwd, root);
    assert.equal(roots[0]!.id, browseRootIdFor(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('browse lists sub-directories, marks git repos, and excludes .git/sensitive', async () => {
  const root = await makeTree();
  try {
    const svc = new BrowseService([root]);
    const res = await svc.browse();
    assert.equal(res.rootId, browseRootIdFor(root));
    assert.equal(res.path, '');
    assert.equal(res.parent, null); // cannot go above the root
    assert.equal(res.cwd, root);
    const names = res.dirs.map((d) => d.name);
    assert.deepEqual(names, ['alpha', 'beta']); // sorted; .git excluded; files excluded
    assert.equal(res.dirs.find((d) => d.name === 'beta')!.isGitRepo, true);
    assert.equal(res.dirs.find((d) => d.name === 'alpha')!.isGitRepo, false);
    // the roots list is included so the phone can offer a picker
    assert.equal(res.roots.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('browse descends into a sub-directory with correct path/parent/cwd', async () => {
  const root = await makeTree();
  try {
    const svc = new BrowseService([root]);
    const id = browseRootIdFor(root);
    const res = await svc.browse(id, 'alpha');
    assert.equal(res.path, 'alpha');
    assert.equal(res.parent, ''); // parent is the root
    assert.equal(res.cwd, join(root, 'alpha'));
    assert.deepEqual(
      res.dirs.map((d) => d.name),
      ['nested'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('browse rejects an attempt to escape above the root', async () => {
  const root = await makeTree();
  try {
    const svc = new BrowseService([root]);
    await assert.rejects(
      () => svc.browse(browseRootIdFor(root), '..'),
      (err: unknown) =>
        err instanceof RpcError && err.code === JsonRpcErrorCode.WorkspaceAccessDenied,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('browse with an unknown root id is rejected', async () => {
  const root = await makeTree();
  try {
    const svc = new BrowseService([root]);
    await assert.rejects(
      () => svc.browse('root_deadbeef'),
      (err: unknown) => err instanceof RpcError && err.code === JsonRpcErrorCode.ResourceNotFound,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an empty browseRoots falls back to a non-empty default root', () => {
  const svc = new BrowseService([], tmpdir());
  const roots = svc.listRoots();
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.cwd, resolve(tmpdir()));
});
