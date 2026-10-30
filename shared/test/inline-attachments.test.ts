import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACHMENT_MARKER,
  countAttachmentMarkers,
  inlineAttachmentsError,
  inlineAttachmentsPlainText,
  splitAtAttachmentMarkers,
  stripAttachmentMarkers,
} from '../src/index.js';

const M = ATTACHMENT_MARKER;

test('the marker is U+FFFC, one UTF-16 unit', () => {
  assert.equal(M, '￼');
  assert.equal(M.length, 1);
});

test('countAttachmentMarkers counts every marker and nothing else', () => {
  assert.equal(countAttachmentMarkers(''), 0);
  assert.equal(countAttachmentMarkers('no attachments here'), 0);
  assert.equal(countAttachmentMarkers(`in ${M} and ${M}${M}`), 3);
  // Other "special" characters are text.
  assert.equal(countAttachmentMarkers('�​'), 0);
});

test('splitAtAttachmentMarkers gives one piece more than markers', () => {
  assert.deepEqual(splitAtAttachmentMarkers('plain'), ['plain']);
  assert.deepEqual(splitAtAttachmentMarkers(`a ${M} b ${M}`), ['a ', ' b ', '']);
  assert.deepEqual(splitAtAttachmentMarkers(M), ['', '']);
});

test('stripAttachmentMarkers removes markers and keeps the words', () => {
  assert.equal(stripAttachmentMarkers(`see ${M}here${M}`), 'see here');
  assert.equal(stripAttachmentMarkers('untouched'), 'untouched');
});

test('inlineAttachmentsError accepts exactly one marker per attachment', () => {
  assert.equal(inlineAttachmentsError('', 0), undefined);
  assert.equal(inlineAttachmentsError(`a ${M} b ${M}`, 2), undefined);
  assert.equal(inlineAttachmentsError(M, 1), undefined);
  assert.match(
    inlineAttachmentsError('text only', 1) ?? '',
    /0 attachment marker\(s\).*1 attachment/,
  );
  assert.match(inlineAttachmentsError(`${M}${M}`, 1) ?? '', /2 attachment marker/);
  assert.match(inlineAttachmentsError(M, 0) ?? '', /1 attachment marker/);
});

test('inlineAttachmentsPlainText names each attachment where it sat', () => {
  assert.equal(
    inlineAttachmentsPlainText(`in ${M} you see X, in ${M} Y`, ['a.png', 'b.png']),
    'in [a.png] you see X, in [b.png] Y',
  );
  // No name, a blank name or a missing entry fall back.
  assert.equal(
    inlineAttachmentsPlainText(`${M} ${M} ${M}`, ['x.pdf', '  ']),
    '[x.pdf] [attachment] [attachment]',
  );
  assert.equal(inlineAttachmentsPlainText(`${M}`, [], 'image'), '[image]');
  assert.equal(inlineAttachmentsPlainText('words only', ['ignored']), 'words only');
});
