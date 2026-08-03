import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import { WorkspaceService } from '../../src/index.js';
import { runGit } from '../../src/git/git-runner.js';

const ws = new WorkspaceService();

// Canonicalized on purpose: link resolution returns a `realpath`, and a temp
// dir is a symlink on macOS and an 8.3 short path on Windows CI, so an
// un-canonicalized fixture root would not equal what the service returns.
async function newRoot(): Promise<string> {
  const dir = join(tmpdir(), `uxnan-ws-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return realpath(dir);
}

test('resolveFileLink keeps files inside the conversation workspace', async () => {
  const root = await newRoot();
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs', 'summary.md'), '# Summary');

  const target = await ws.resolveFileLink(root, 'docs/summary.md#L1');
  assert.deepEqual(target, { cwd: root, path: 'docs/summary.md' });
  await rm(root, { recursive: true, force: true });
});

test('resolveFileLink selects a sibling git worktree as the viewer root', async () => {
  const parent = await newRoot();
  const conversation = join(parent, 'worktree-x');
  const linkedWorktree = join(parent, 'worktree-y');
  await mkdir(conversation);
  await mkdir(join(linkedWorktree, 'notes'), { recursive: true });
  await runGit(linkedWorktree, ['init', '-b', 'main']);
  const linkedFile = join(linkedWorktree, 'notes', 'resume file.md');
  await writeFile(linkedFile, '# Handoff');

  const relativeTarget = await ws.resolveFileLink(
    conversation,
    '../worktree-y/notes/resume%20file.md:42#L42',
  );
  assert.deepEqual(relativeTarget, {
    cwd: linkedWorktree,
    path: 'notes/resume file.md',
  });

  const fileUrlTarget = await ws.resolveFileLink(conversation, pathToFileURL(linkedFile).href);
  assert.equal(fileUrlTarget.cwd, linkedWorktree);
  assert.equal(fileUrlTarget.path, relative(linkedWorktree, linkedFile).replaceAll('\\', '/'));
  await rm(parent, { recursive: true, force: true });
});

test('resolveFileLink falls back to the containing directory outside a repo', async () => {
  const parent = await newRoot();
  const conversation = join(parent, 'repo-x');
  const loose = join(parent, 'scratch');
  await mkdir(conversation);
  await mkdir(loose);
  await writeFile(join(loose, 'notes.md'), '# Notes');

  // No git root to anchor to, so the viewer root stays as narrow as possible.
  const target = await ws.resolveFileLink(conversation, join(loose, 'notes.md'));
  assert.deepEqual(target, { cwd: loose, path: 'notes.md' });
  await rm(parent, { recursive: true, force: true });
});

test('resolveFileLink resolves an absolute link after the conversation cwd is gone', async () => {
  const parent = await newRoot();
  const conversation = join(parent, 'removed-x');
  const worktree = join(parent, 'kept-y');
  await mkdir(worktree, { recursive: true });
  await runGit(worktree, ['init', '-b', 'main']);
  await writeFile(join(worktree, 'resume.md'), '# Resume');

  // The thread's folder can be deleted (a worktree is removed, a branch is
  // pruned) while its transcript still cites a file that outlived it.
  const target = await ws.resolveFileLink(conversation, join(worktree, 'resume.md'));
  assert.deepEqual(target, { cwd: worktree, path: 'resume.md' });
  await rm(parent, { recursive: true, force: true });
});

test('resolveFileLink denies .git internals in another worktree', async () => {
  const parent = await newRoot();
  const conversation = join(parent, 'x');
  const worktree = join(parent, 'y');
  await mkdir(conversation);
  await mkdir(worktree);
  await runGit(worktree, ['init', '-b', 'main']);

  for (const href of ['../y/.git/config', join(worktree, '.git', 'HEAD')]) {
    await assert.rejects(
      ws.resolveFileLink(conversation, href),
      (error: unknown) =>
        error instanceof RpcError && error.code === JsonRpcErrorCode.WorkspaceAccessDenied,
    );
  }
  await rm(parent, { recursive: true, force: true });
});

test('resolveFileLink rejects remote, missing, directory, and sensitive targets', async () => {
  const root = await newRoot();
  await mkdir(join(root, 'folder'));
  await writeFile(join(root, '.env'), 'SECRET=1');

  await assert.rejects(
    ws.resolveFileLink(root, 'https://example.com/file.md'),
    (error: unknown) => error instanceof RpcError && error.code === JsonRpcErrorCode.InvalidParams,
  );
  await assert.rejects(
    ws.resolveFileLink(root, 'missing.md'),
    (error: unknown) =>
      error instanceof RpcError && error.code === JsonRpcErrorCode.ResourceNotFound,
  );
  await assert.rejects(
    ws.resolveFileLink(root, 'folder'),
    (error: unknown) => error instanceof RpcError && error.code === JsonRpcErrorCode.InvalidParams,
  );
  await assert.rejects(
    ws.resolveFileLink(root, '.env'),
    (error: unknown) =>
      error instanceof RpcError && error.code === JsonRpcErrorCode.WorkspaceAccessDenied,
  );
  await rm(root, { recursive: true, force: true });
});

test('readFile returns utf-8 text and binary as base64', async () => {
  const root = await newRoot();
  await writeFile(join(root, 'note.txt'), 'hola');
  const text = await ws.readFile(root, 'note.txt');
  assert.deepEqual(text, { path: 'note.txt', content: 'hola', encoding: 'utf-8' });

  await writeFile(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]));
  const bin = await ws.readFile(root, 'blob.bin');
  assert.equal(bin.encoding, 'base64');
  assert.equal(Buffer.from(bin.content, 'base64').length, 5);
  await rm(root, { recursive: true, force: true });
});

test('readImage infers the mime type', async () => {
  const root = await newRoot();
  await writeFile(join(root, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const img = await ws.readImage(root, 'pic.png');
  assert.equal(img.mimeType, 'image/png');
  assert.ok(img.base64Data.length > 0);
  await assert.rejects(ws.readImage(root, 'pic.txt'), RpcError);
  await rm(root, { recursive: true, force: true });
});

test('list excludes .git and sensitive files and sorts dirs first', async () => {
  const root = await newRoot();
  await mkdir(join(root, '.git'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, '.env'), 'SECRET=1');
  await writeFile(join(root, 'readme.md'), '# hi');
  const listing = await ws.list(root);
  const names = listing.entries.map((e) => e.name);
  assert.ok(!names.includes('.git'));
  assert.ok(!names.includes('.env'));
  assert.deepEqual(names, ['src', 'readme.md']);
  // Files carry size + last-modified (one stat); directories carry neither.
  const file = listing.entries.find((e) => e.name === 'readme.md');
  const dir = listing.entries.find((e) => e.name === 'src');
  assert.equal(file?.size, 4); // '# hi'
  assert.equal(typeof file?.mtime, 'number');
  assert.ok((file?.mtime ?? 0) > 0);
  assert.equal(dir?.size, undefined);
  assert.equal(dir?.mtime, undefined);
  await rm(root, { recursive: true, force: true });
});

test('list flags git-ignored entries and leaves tracked/clean ones un-flagged', async () => {
  const root = await newRoot();
  await runGit(root, ['init', '-b', 'main']);
  await writeFile(join(root, '.gitignore'), 'ignored.txt\nbuild/\n');
  await writeFile(join(root, 'ignored.txt'), 'x');
  await writeFile(join(root, 'kept.txt'), 'x');
  await mkdir(join(root, 'build'));
  const listing = await ws.list(root);
  const byName = new Map(listing.entries.map((e) => [e.name, e]));
  // A matched file and a matched directory are both flagged.
  assert.equal(byName.get('ignored.txt')?.ignored, true);
  assert.equal(byName.get('build')?.ignored, true);
  // A normal file and the `.gitignore` itself are not flagged (absent/false).
  assert.ok(!byName.get('kept.txt')?.ignored);
  assert.ok(!byName.get('.gitignore')?.ignored);
  await rm(root, { recursive: true, force: true });
});

test('list leaves entries un-flagged outside a git repository', async () => {
  const root = await newRoot();
  await writeFile(join(root, 'a.txt'), 'x');
  const listing = await ws.list(root);
  assert.ok(!listing.entries.find((e) => e.name === 'a.txt')?.ignored);
  await rm(root, { recursive: true, force: true });
});

test('applyPatch adds, modifies and deletes files', async () => {
  const root = await newRoot();
  await writeFile(join(root, 'old.txt'), 'remove me');
  const result = await ws.applyPatch(root, [
    { op: 'add', path: 'nested/new.txt', content: 'created' },
    { op: 'delete', path: 'old.txt' },
  ]);
  assert.deepEqual(result, { success: true, applied: 2 });
  assert.equal((await ws.readFile(root, 'nested/new.txt')).content, 'created');
  await assert.rejects(ws.readFile(root, 'old.txt'), RpcError);
  await rm(root, { recursive: true, force: true });
});

test('path traversal, .git and sensitive files are denied', async () => {
  const root = await newRoot();
  for (const bad of ['../escape.txt', '.git/config', '.env']) {
    await assert.rejects(
      ws.readFile(root, bad),
      (err) => err instanceof RpcError && err.code === JsonRpcErrorCode.WorkspaceAccessDenied,
    );
  }
  await rm(root, { recursive: true, force: true });
});

test('searchFiles fuzzy-matches files and their ancestor dirs across the repo', async () => {
  const root = await newRoot();
  await runGit(root, ['init', '-b', 'main']);
  await mkdir(join(root, 'lib', 'presentation'), { recursive: true });
  await writeFile(join(root, 'lib', 'main.dart'), 'void main() {}');
  await writeFile(join(root, 'lib', 'presentation', 'home.dart'), 'class Home {}');
  await writeFile(join(root, 'README.md'), '# hi');

  const byName = await ws.searchFiles(root, 'main');
  const paths = byName.matches.map((m) => m.path);
  // A basename hit ranks first.
  assert.equal(paths[0], 'lib/main.dart');
  assert.ok(!byName.truncated);

  // A nested path query works (path substring), and the dir is matchable too.
  const nested = await ws.searchFiles(root, 'presentation/home');
  assert.ok(
    nested.matches.some((m) => m.path === 'lib/presentation/home.dart' && m.type === 'file'),
  );
  const dirHit = await ws.searchFiles(root, 'presentation');
  assert.ok(dirHit.matches.some((m) => m.path === 'lib/presentation' && m.type === 'dir'));
  await rm(root, { recursive: true, force: true });
});

test('searchFiles respects .gitignore and excludes sensitive files', async () => {
  const root = await newRoot();
  await runGit(root, ['init', '-b', 'main']);
  await writeFile(join(root, '.gitignore'), 'build/\nsecret.txt\n');
  await mkdir(join(root, 'build'), { recursive: true });
  await writeFile(join(root, 'build', 'out.js'), '1');
  await writeFile(join(root, 'secret.txt'), 'x');
  await writeFile(join(root, '.env'), 'TOKEN=1');
  await writeFile(join(root, 'keep.txt'), 'x');

  const all = await ws.searchFiles(root, '');
  const paths = all.matches.map((m) => m.path);
  assert.ok(paths.includes('keep.txt'));
  // git-ignored and sensitive entries never surface.
  assert.ok(!paths.includes('build/out.js'));
  assert.ok(!paths.includes('build'));
  assert.ok(!paths.includes('secret.txt'));
  assert.ok(!paths.includes('.env'));
  await rm(root, { recursive: true, force: true });
});

test('searchFiles caps results and flags truncation', async () => {
  const root = await newRoot();
  await runGit(root, ['init', '-b', 'main']);
  for (let i = 0; i < 10; i++) {
    await writeFile(join(root, `note${i}.txt`), 'x');
  }
  const capped = await ws.searchFiles(root, 'note', 3);
  assert.equal(capped.matches.length, 3);
  assert.ok(capped.truncated);
  await rm(root, { recursive: true, force: true });
});

test('searchFiles works outside a git repo via the walk fallback', async () => {
  const root = await newRoot();
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'app.ts'), '1');
  const res = await ws.searchFiles(root, 'app');
  assert.ok(res.matches.some((m) => m.path === 'src/app.ts'));
  await rm(root, { recursive: true, force: true });
});
