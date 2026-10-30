import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TurnInputPart } from '@uxnan/shared';
import {
  acpPrompt,
  claudeContent,
  codexInput,
  imagesOnly,
  openCodeV1Parts,
  openCodeV2Files,
  piImages,
  turnParts,
} from '../../src/adapters/turn-input.js';
import { commandArgs } from '../../src/adapters/opencode-adapter.js';

// "in [Image 1: a.png] a cat, in [Image 2] a dog" with each image after its label.
const input: TurnInputPart[] = [
  { type: 'text', text: 'in [Image 1: a.png]' },
  {
    type: 'image',
    label: '[Image 1: a.png]',
    name: 'a.png',
    mimeType: 'image/png',
    base64Data: 'AAAA',
  },
  { type: 'text', text: ' a cat, in [Image 2]' },
  { type: 'image', label: '[Image 2]', mimeType: 'image/jpeg', base64Data: 'BBBB' },
  { type: 'text', text: ' a dog' },
];
const text = 'in [Image 1: a.png] a cat, in [Image 2] a dog';
const turn = { text, input };

test('turnParts is the input, or the text as one part', () => {
  assert.equal(turnParts(turn), input);
  assert.deepEqual(turnParts({ text: 'hi' }), [{ type: 'text', text: 'hi' }]);
});

test('imagesOnly keeps the image parts', () => {
  assert.deepEqual(
    imagesOnly(input).map((p) => p.type),
    ['image', 'image'],
  );
  assert.deepEqual(imagesOnly(undefined), []);
});

test('claudeContent interleaves text and base64 image blocks', () => {
  assert.deepEqual(claudeContent(turn), [
    { type: 'text', text: 'in [Image 1: a.png]' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    { type: 'text', text: ' a cat, in [Image 2]' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } },
    { type: 'text', text: ' a dog' },
  ]);
  assert.deepEqual(claudeContent({ text: 'plain' }), [{ type: 'text', text: 'plain' }]);
});

test('codexInput interleaves text and data-URL image items', () => {
  assert.deepEqual(codexInput(turn), [
    { type: 'text', text: 'in [Image 1: a.png]' },
    { type: 'image', url: 'data:image/png;base64,AAAA' },
    { type: 'text', text: ' a cat, in [Image 2]' },
    { type: 'image', url: 'data:image/jpeg;base64,BBBB' },
    { type: 'text', text: ' a dog' },
  ]);
  assert.deepEqual(codexInput({ text: 'plain' }), [{ type: 'text', text: 'plain' }]);
});

test('acpPrompt interleaves text and inline image blocks, never empty', () => {
  assert.deepEqual(acpPrompt(turn), [
    { type: 'text', text: 'in [Image 1: a.png]' },
    { type: 'image', mimeType: 'image/png', data: 'AAAA' },
    { type: 'text', text: ' a cat, in [Image 2]' },
    { type: 'image', mimeType: 'image/jpeg', data: 'BBBB' },
    { type: 'text', text: ' a dog' },
  ]);
  assert.deepEqual(acpPrompt({ text: '' }), [{ type: 'text', text: '' }]);
});

test('piImages lists the images in order', () => {
  assert.deepEqual(piImages(turn), [
    { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
  ]);
  assert.deepEqual(piImages({}), []);
});

test('openCodeV2Files ties each image to its label in the text', () => {
  const files = openCodeV2Files(turn);
  assert.deepEqual(files, [
    {
      uri: 'data:image/png;base64,AAAA',
      name: 'a.png',
      mention: { start: 3, end: 19, text: '[Image 1: a.png]' },
    },
    {
      uri: 'data:image/jpeg;base64,BBBB',
      mention: { start: 30, end: 39, text: '[Image 2]' },
    },
  ]);
  for (const f of files) {
    const m = f['mention'] as { start: number; end: number; text: string };
    assert.equal(text.slice(m.start, m.end), m.text);
  }
  assert.deepEqual(openCodeV2Files({ text: 'plain' }), []);
});

test('openCodeV1Parts interleaves text and file parts', () => {
  assert.deepEqual(openCodeV1Parts(turn), [
    { type: 'text', text: 'in [Image 1: a.png]' },
    { type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA', filename: 'a.png' },
    { type: 'text', text: ' a cat, in [Image 2]' },
    { type: 'file', mime: 'image/jpeg', url: 'data:image/jpeg;base64,BBBB' },
    { type: 'text', text: ' a dog' },
  ]);
  assert.deepEqual(openCodeV1Parts({ text: 'plain' }), [{ type: 'text', text: 'plain' }]);
});

test('commandArgs takes what follows /name in the composed prompt', () => {
  assert.equal(
    commandArgs('/review [Image 1: a.png] this\n\n[Attachments — …]', {
      name: 'review',
      args: '[Image 1: a.png] this',
    }),
    '[Image 1: a.png] this\n\n[Attachments — …]',
  );
  assert.equal(commandArgs('/review', { name: 'review' }), '');
  // Not in that form (an expanded template): the arguments alone.
  assert.equal(commandArgs('Review the code', { name: 'review', args: ' x ' }), 'x');
  // A longer command sharing the prefix is not this one.
  assert.equal(commandArgs('/reviewer go', { name: 'review', args: 'go' }), 'go');
});
