import { describe, expect, it } from 'vitest';
import { messagePieces, messagePlainText, pendingChips, sentChips } from './inlineMessage';

const M = '￼';

describe('inline message', () => {
  it('cuts a message where its attachments sit', () => {
    expect(messagePieces(`in ${M} X, in ${M} Y`, ['a', 'b'])).toEqual([
      { kind: 'text', text: 'in ' },
      { kind: 'attachment', attachment: 'a', index: 0, trailing: false },
      { kind: 'text', text: ' X, in ' },
      { kind: 'attachment', attachment: 'b', index: 1, trailing: false },
      { kind: 'text', text: ' Y' },
    ]);
    expect(messagePieces(M, ['only'])).toEqual([
      { kind: 'attachment', attachment: 'only', index: 0, trailing: false },
    ]);
  });

  it('shows attachments without a marker after the text, and draws nothing for a marker without one', () => {
    expect(messagePieces('old message', ['a'])).toEqual([
      { kind: 'text', text: 'old message' },
      { kind: 'attachment', attachment: 'a', index: 0, trailing: true },
    ]);
    expect(messagePieces(`${M} and ${M}`, ['a'])).toEqual([
      { kind: 'attachment', attachment: 'a', index: 0, trailing: false },
      { kind: 'text', text: ' and ' },
    ]);
    expect(messagePieces('', [])).toEqual([]);
  });

  it('makes chips of stored and pending attachments, each named', async () => {
    const stored = sentChips(
      [
        { id: 't-0.png', mimeType: 'image/png', bytes: 3 },
        { id: 't-1.pdf', mimeType: 'application/pdf', bytes: 9, name: 'spec.pdf' },
      ],
      (id) => Promise.resolve(`url:${id}`),
    );
    expect(stored.map((c) => [c.name, c.kind])).toEqual([
      ['image.png', 'image'],
      ['spec.pdf', 'file'],
    ]);
    await expect(stored[1]!.load()).resolves.toBe('url:t-1.pdf');
    const pending = pendingChips([{ type: 'image', name: 'a.png', mimeType: 'image/png', base64Data: 'AA==' }], 'c1');
    expect(pending[0]).toMatchObject({ id: 'c1-0', name: 'a.png', kind: 'image' });
    await expect(pending[0]!.load()).resolves.toBe('data:image/png;base64,AA==');
  });

  it('writes a message for a place that shows only words', () => {
    expect(
      messagePlainText(`see ${M} and ${M}`, [
        { mimeType: 'image/png' },
        { mimeType: 'text/csv', name: 'data.csv' },
      ]),
    ).toBe('see [image.png] and [data.csv]');
  });
});
