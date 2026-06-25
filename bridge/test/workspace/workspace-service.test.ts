import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import { WorkspaceService } from '../../src/index.js';

const ws = new WorkspaceService();

async function newRoot(): Promise<string> {
  const dir = join(tmpdir(), `uxnan-ws-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

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
