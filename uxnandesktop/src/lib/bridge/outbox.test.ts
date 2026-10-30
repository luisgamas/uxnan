import { describe, expect, it } from 'vitest';
import { withAttachments, type OutboxEntry } from './outbox';

const M = '￼';
const image = { type: 'image' as const, name: 'a.png', mimeType: 'image/png', base64Data: 'AA==' };

describe('outbox entries', () => {
  it('keeps a message whose markers match what it carries', () => {
    const entry: OutboxEntry = {
      clientTurnId: 'c',
      text: `see ${M}`,
      request: { text: `see ${M}`, attachments: [image] },
    };
    expect(withAttachments(entry)).toBe(entry);
  });

  it('sends only the words of one whose attachments are gone', () => {
    expect(
      withAttachments({ clientTurnId: 'c', text: `see ${M} now`, request: { text: `see ${M} now` } }),
    ).toEqual({ clientTurnId: 'c', text: 'see  now', request: { text: 'see  now' } });
    expect(
      withAttachments({
        clientTurnId: 'c',
        text: `/review ${M}`,
        request: { command: { name: 'review', args: M }, attachments: [] },
      }),
    ).toEqual({ clientTurnId: 'c', text: '/review ', request: { command: { name: 'review', args: '' } } });
  });

  it('counts the markers of a command in its arguments', () => {
    const entry: OutboxEntry = {
      clientTurnId: 'c',
      text: `/review ${M}`,
      request: { command: { name: 'review', args: M }, attachments: [image] },
    };
    expect(withAttachments(entry)).toBe(entry);
  });
});
