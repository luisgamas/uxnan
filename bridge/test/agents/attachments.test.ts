import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { ATTACHMENTS_DIRNAME, materializeAttachments } from '../../src/agents/attachments.js';

// A real 1x1 transparent PNG (base64, no data: prefix) — what the phone sends.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('materializeAttachments writes the image INSIDE the cwd and references it relatively', async () => {
  const cwd = join(tmpdir(), `uxnan-cwd-${randomUUID()}`);
  await mkdir(cwd, { recursive: true });
  const { paths, note, dir } = await materializeAttachments(
    [{ type: 'image', mimeType: 'image/png', base64Data: PNG_1x1 }],
    'turn-1',
    { cwd },
  );
  assert.equal(paths.length, 1);
  // File lands under <cwd>/.uxnan-attachments/... so a sandboxed agent can read it.
  assert.ok(paths[0]!.startsWith(cwd));
  assert.ok(paths[0]!.includes(ATTACHMENTS_DIRNAME));
  assert.ok(paths[0]!.endsWith('.png'));
  const bytes = await readFile(paths[0]!);
  assert.ok(bytes.length > 0);
  // The prompt note references a cwd-relative POSIX path (not the absolute one).
  assert.match(note, /Attached image/);
  assert.ok(note.includes(`${ATTACHMENTS_DIRNAME}/turn-1/image-0.png`));
  assert.ok(!note.includes(cwd));
  assert.equal(dir, join(cwd, ATTACHMENTS_DIRNAME, 'turn-1'));
  await rm(cwd, { recursive: true, force: true });
});

test('materializeAttachments falls back to a temp dir (absolute ref) without a cwd', async () => {
  const { paths, note } = await materializeAttachments(
    [{ type: 'image', mimeType: 'image/png', base64Data: PNG_1x1 }],
    'turn-tmp',
  );
  assert.equal(paths.length, 1);
  assert.ok(paths[0]!.endsWith('.png'));
  assert.ok(note.includes(paths[0]!));
  await rm(join(tmpdir(), 'uxnan-attachments', 'turn-tmp'), {
    recursive: true,
    force: true,
  });
});

test('materializeAttachments returns empty for no attachments', async () => {
  const res = await materializeAttachments([], 'turn-x');
  assert.deepEqual(res, { paths: [], note: '' });
});

test('materializeAttachments references an existing path without copying', async () => {
  const cwd = join(tmpdir(), `uxnan-cwd-${randomUUID()}`);
  const dir = join(cwd, 'src');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'pic.png');
  await writeFile(file, Buffer.from(PNG_1x1, 'base64'));
  const { paths, note } = await materializeAttachments(
    [{ type: 'image', mimeType: 'image/png', path: file }],
    'turn-2',
    { cwd },
  );
  assert.deepEqual(paths, [file]);
  // Referenced relative to cwd.
  assert.ok(note.includes('src/pic.png'));
  await rm(cwd, { recursive: true, force: true });
});

test('materializeAttachments skips entries with empty base64 and no path', async () => {
  const cwd = join(tmpdir(), `uxnan-cwd-${randomUUID()}`);
  await mkdir(cwd, { recursive: true });
  const { paths, note } = await materializeAttachments(
    [{ type: 'image', mimeType: 'image/png', base64Data: '' }],
    'turn-3',
    { cwd },
  );
  assert.deepEqual(paths, []);
  assert.equal(note, '');
  await rm(cwd, { recursive: true, force: true });
});

test('materializeAttachments uses the right extension per MIME type', async () => {
  const cwd = join(tmpdir(), `uxnan-cwd-${randomUUID()}`);
  await mkdir(cwd, { recursive: true });
  const { paths } = await materializeAttachments(
    [
      { type: 'image', mimeType: 'image/jpeg', base64Data: PNG_1x1 },
      { type: 'image', mimeType: 'image/webp', base64Data: PNG_1x1 },
    ],
    'turn-4',
    { cwd },
  );
  assert.equal(paths.length, 2);
  assert.ok(paths[0]!.endsWith('.jpg'));
  assert.ok(paths[1]!.endsWith('.webp'));
  await rm(cwd, { recursive: true, force: true });
});
