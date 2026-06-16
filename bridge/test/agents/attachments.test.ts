import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { materializeAttachments } from '../../src/agents/attachments.js';

// A real 1x1 transparent PNG (base64, no data: prefix) — what the phone sends.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('materializeAttachments writes an inline image to a temp file and references it', async () => {
  const base = join(tmpdir(), `uxnan-att-${randomUUID()}`);
  const { paths, note } = await materializeAttachments(
    [{ type: 'image', mimeType: 'image/png', base64Data: PNG_1x1 }],
    'turn-1',
    base,
  );
  assert.equal(paths.length, 1);
  assert.ok(paths[0]!.endsWith('.png'));
  const bytes = await readFile(paths[0]!);
  assert.ok(bytes.length > 0);
  assert.ok(note.includes(paths[0]!));
  assert.match(note, /Attached image/);
  await rm(base, { recursive: true, force: true });
});

test('materializeAttachments returns empty for no attachments', async () => {
  const res = await materializeAttachments([], 'turn-x');
  assert.deepEqual(res, { paths: [], note: '' });
});

test('materializeAttachments references an existing path without copying when there is no base64', async () => {
  const base = join(tmpdir(), `uxnan-att-${randomUUID()}`);
  const dir = join(base, 'src');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'pic.png');
  await writeFile(file, Buffer.from(PNG_1x1, 'base64'));
  const { paths, note } = await materializeAttachments(
    [{ type: 'image', mimeType: 'image/png', path: file }],
    'turn-2',
    base,
  );
  assert.deepEqual(paths, [file]);
  assert.ok(note.includes(file));
  await rm(base, { recursive: true, force: true });
});

test('materializeAttachments skips entries with empty base64 and no path', async () => {
  const base = join(tmpdir(), `uxnan-att-${randomUUID()}`);
  const { paths, note } = await materializeAttachments(
    [{ type: 'image', mimeType: 'image/png', base64Data: '' }],
    'turn-3',
    base,
  );
  assert.deepEqual(paths, []);
  assert.equal(note, '');
  await rm(base, { recursive: true, force: true });
});

test('materializeAttachments uses the right extension per MIME type', async () => {
  const base = join(tmpdir(), `uxnan-att-${randomUUID()}`);
  const { paths } = await materializeAttachments(
    [
      { type: 'image', mimeType: 'image/jpeg', base64Data: PNG_1x1 },
      { type: 'image', mimeType: 'image/webp', base64Data: PNG_1x1 },
    ],
    'turn-4',
    base,
  );
  assert.equal(paths.length, 2);
  assert.ok(paths[0]!.endsWith('.jpg'));
  assert.ok(paths[1]!.endsWith('.webp'));
  await rm(base, { recursive: true, force: true });
});
