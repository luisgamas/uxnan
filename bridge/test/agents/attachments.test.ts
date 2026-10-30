import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import type { TurnAttachment } from '@uxnan/shared';
import {
  ATTACHMENTS_DIRNAME,
  attachmentLabel,
  attachmentNote,
  interleaveImages,
  labelMarkers,
  prepareAttachments,
  sanitizeFileName,
  withNote,
} from '../../src/agents/attachments.js';
import { rmrf } from '../helpers/fs.js';

// A real 1x1 transparent PNG (base64, no data: prefix) — what the phone sends.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const M = '\uFFFC';

const image = (name?: string, mimeType = 'image/png'): TurnAttachment => ({
  type: 'image',
  mimeType,
  base64Data: PNG_1x1,
  ...(name !== undefined ? { name } : {}),
});
const file = (name: string): TurnAttachment => ({
  type: 'file',
  name,
  mimeType: 'text/csv',
  base64Data: Buffer.from('a,b\n1,2\n').toString('base64'),
});

async function scratchCwd(): Promise<string> {
  const cwd = join(tmpdir(), `uxnan-cwd-${randomUUID()}`);
  await mkdir(cwd, { recursive: true });
  return cwd;
}

test('prepareAttachments writes every attachment INSIDE the cwd, each in its own folder', async () => {
  const cwd = await scratchCwd();
  try {
    const prepared = await prepareAttachments(
      [image('shot.png'), file('data.csv'), image('shot.png'), image()],
      'turn-1',
      { cwd },
    );
    assert.equal(prepared.dir, join(cwd, ATTACHMENTS_DIRNAME, 'turn-1'));
    const refs = prepared.items.map((i) => i.reference);
    // Named alike, kept apart; an unnamed image gets one; references are
    // cwd-relative POSIX paths, so a sandboxed agent can open them.
    assert.deepEqual(refs, [
      `${ATTACHMENTS_DIRNAME}/turn-1/1/shot.png`,
      `${ATTACHMENTS_DIRNAME}/turn-1/2/data.csv`,
      `${ATTACHMENTS_DIRNAME}/turn-1/3/shot.png`,
      `${ATTACHMENTS_DIRNAME}/turn-1/4/image-3.png`,
    ]);
    for (const item of prepared.items) {
      assert.ok(item.path?.startsWith(cwd));
      assert.ok((await readFile(item.path!)).length > 0);
    }
    // Numbered per kind, in order.
    assert.deepEqual(
      prepared.items.map((i) => i.label),
      ['[Image 1: shot.png]', '[File 1: data.csv]', '[Image 2: shot.png]', '[Image 3]'],
    );
  } finally {
    await rmrf(cwd);
  }
});

test('prepareAttachments falls back to a temp dir (absolute reference) without a cwd', async () => {
  const prepared = await prepareAttachments([image('a.png')], 'turn-tmp');
  try {
    const [item] = prepared.items;
    assert.ok(item?.path?.endsWith('a.png'));
    assert.equal(item?.reference, item?.path);
  } finally {
    await rm(join(tmpdir(), 'uxnan-attachments', 'turn-tmp'), { recursive: true, force: true });
  }
});

test('prepareAttachments of nothing writes nothing', async () => {
  assert.deepEqual(await prepareAttachments([], 'turn-x'), { items: [] });
});

test('an image is inline only for an adapter that takes images, and only in a type models accept', async () => {
  const cwd = await scratchCwd();
  try {
    const inline = await prepareAttachments(
      [image('a.png'), image('b.heic', 'image/heic'), file('c.csv')],
      'turn-i',
      { cwd, inlineImages: true },
    );
    assert.deepEqual(
      inline.items.map((i) => i.inline),
      [true, false, false],
    );
    const plain = await prepareAttachments([image('a.png')], 'turn-p', { cwd });
    assert.equal(plain.items[0]?.inline, false);
  } finally {
    await rmrf(cwd);
  }
});

test('attachmentLabel numbers by kind and keeps a name that cannot break the label', () => {
  assert.equal(attachmentLabel('image', 1, 'a.png'), '[Image 1: a.png]');
  assert.equal(attachmentLabel('file', 2, 'report.pdf'), '[File 2: report.pdf]');
  assert.equal(attachmentLabel('image', 3), '[Image 3]');
  assert.equal(attachmentLabel('image', 4, '   '), '[Image 4]');
  assert.equal(attachmentLabel('file', 1, 'we[ir]d\nname.txt'), '[File 1: we ir d name.txt]');
  assert.equal(attachmentLabel('file', 1, 'x'.repeat(200)).length, '[File 1: ]'.length + 80);
});

test('labelMarkers puts each label where its marker was', async () => {
  const cwd = await scratchCwd();
  try {
    const prepared = await prepareAttachments([image('a.png'), file('b.csv')], 't', { cwd });
    assert.equal(
      labelMarkers(`in this image ${M} you can see X, and in ${M} Y`, prepared),
      'in this image [Image 1: a.png] you can see X, and in [File 1: b.csv] Y',
    );
    // An attachment-only message is its labels.
    assert.equal(labelMarkers(`${M}${M}`, prepared), '[Image 1: a.png][File 1: b.csv]');
    // A marker with no attachment behind it is dropped, never left raw.
    assert.equal(
      labelMarkers(`a ${M} b ${M} c ${M}`, prepared),
      'a [Image 1: a.png] b [File 1: b.csv] c ',
    );
  } finally {
    await rmrf(cwd);
  }
});

test('attachmentNote maps every label to its file, worded by how the agent gets it', async () => {
  const cwd = await scratchCwd();
  try {
    const opened = await prepareAttachments([image('a.png'), file('b.csv')], 't', { cwd });
    const note = attachmentNote(opened);
    assert.match(note, /^\[Attachments — each label in the message above is one of these:/);
    assert.ok(
      note.includes(
        `- Image 1: a.png: ${ATTACHMENTS_DIRNAME}/t/1/a.png (open it with your file/vision tools to see it)`,
      ),
    );
    assert.ok(
      note.includes(
        `- File 1: b.csv: ${ATTACHMENTS_DIRNAME}/t/2/b.csv (open it with your file tools)`,
      ),
    );
    assert.ok(!note.includes(cwd));

    const inline = await prepareAttachments([image('a.png')], 'u', { cwd, inlineImages: true });
    assert.ok(
      attachmentNote(inline).includes(
        `- Image 1: a.png: sent with this message as an image, right after its label; its file is ${ATTACHMENTS_DIRNAME}/u/1/a.png`,
      ),
    );
    assert.equal(attachmentNote({ items: [] }), '');
  } finally {
    await rmrf(cwd);
  }
});

test('interleaveImages puts each inline image right after its label, the note last', async () => {
  const cwd = await scratchCwd();
  try {
    const prepared = await prepareAttachments(
      [image('a.png'), file('c.csv'), image('b.png')],
      't',
      {
        cwd,
        inlineImages: true,
      },
    );
    const message = labelMarkers(`first ${M} red, then ${M} and ${M} blue`, prepared);
    const note = attachmentNote(prepared);
    const parts = interleaveImages(message, note, prepared);
    assert.deepEqual(
      parts?.map((p) => (p.type === 'text' ? p.text : `<${p.label}>`)),
      [
        'first [Image 1: a.png]',
        '<[Image 1: a.png]>',
        ' red, then [File 1: c.csv] and [Image 2: b.png]',
        '<[Image 2: b.png]>',
        ` blue\n\n${note}`,
      ],
    );
    // The text pieces are exactly the prompt the agent would read as text.
    const text = parts?.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
    assert.equal(text, withNote(message, note));
    const [, first] = parts ?? [];
    assert.equal(first?.type, 'image');
    if (first?.type === 'image') {
      assert.equal(first.base64Data, PNG_1x1);
      assert.equal(first.mimeType, 'image/png');
      assert.equal(first.name, 'a.png');
      assert.ok(first.path?.endsWith('a.png'));
    }
  } finally {
    await rmrf(cwd);
  }
});

test('interleaveImages puts an image whose label is gone at the end of the message', async () => {
  const cwd = await scratchCwd();
  try {
    const prepared = await prepareAttachments([image('a.png')], 't', { cwd, inlineImages: true });
    const parts = interleaveImages('a template that dropped its arguments', 'NOTE', prepared);
    assert.deepEqual(
      parts?.map((p) => (p.type === 'text' ? p.text : '<img>')),
      ['a template that dropped its arguments', '<img>', '\n\nNOTE'],
    );
    // Nothing inline: no parts at all — the adapter sends the text.
    const plain = await prepareAttachments([image('a.png')], 'u', { cwd });
    assert.equal(interleaveImages('x', 'y', plain), undefined);
  } finally {
    await rmrf(cwd);
  }
});

test('withNote joins the message and the note, and leaves a text-only message alone', () => {
  assert.equal(withNote('hi', ''), 'hi');
  assert.equal(withNote('hi', 'N'), 'hi\n\nN');
  assert.equal(withNote('', 'N'), 'N');
});

test('sanitizeFileName keeps a usable last segment', () => {
  assert.equal(sanitizeFileName('dir/sub/report.pdf'), 'report.pdf');
  assert.equal(sanitizeFileName('C:\\x\\a:b?.txt'), 'a_b_.txt');
  assert.equal(sanitizeFileName('trailing. '), 'trailing');
  assert.equal(sanitizeFileName('..'), undefined);
  assert.equal(sanitizeFileName(''), undefined);
  assert.equal(sanitizeFileName(undefined), undefined);
});
