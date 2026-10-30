import { describe, expect, it } from 'vitest';
import {
  attachmentFromTurn,
  base64Bytes,
  extensionOf,
  keepAttachments,
  keptAttachments,
  pastedImageName,
  plainTextOf,
  reconcileDraft,
  savedDraftKey,
  shortName,
  type ComposerAttachment,
} from './composerAttachments';

const M = '￼';

describe('composer attachments', () => {
  it('names a pasted image so two in one message are told apart', () => {
    expect(pastedImageName('diagram.png', 'image/png', [])).toBe('diagram.png');
    expect(pastedImageName('image.png', 'image/png', [])).toBe('image-1.png');
    expect(pastedImageName('image.png', 'image/png', ['image-1.png'])).toBe('image-2.png');
    expect(pastedImageName(undefined, 'image/jpeg', [])).toBe('image-1.jpg');
    expect(pastedImageName('', 'image/x-weird+thing', [])).toBe('image-1.png');
  });

  it('shortens a long name in the middle, keeping its extension', () => {
    expect(shortName('short.pdf')).toBe('short.pdf');
    const long = shortName('a-very-long-quarterly-financial-report-final.pdf', 20);
    expect(long).toHaveLength(20);
    expect(long.startsWith('a-very')).toBe(true);
    expect(long.endsWith('final.pdf')).toBe(true);
    expect(long).toContain('…');
    expect(shortName('no-extension-at-all-but-long', 10)).toHaveLength(10);
  });

  it('keeps a draft whose markers match its attachments, and drops the markers otherwise', () => {
    expect(reconcileDraft(`a ${M} b`, ['x'])).toEqual({ text: `a ${M} b`, attachments: ['x'] });
    expect(reconcileDraft(`a ${M} b`, undefined)).toEqual({ text: 'a  b', attachments: [] });
    expect(reconcileDraft(`${M}${M}`, ['x'])).toEqual({ text: '', attachments: [] });
    expect(reconcileDraft('plain', [])).toEqual({ text: 'plain', attachments: [] });
  });

  it('brings a sent attachment back as a chip', () => {
    const image = attachmentFromTurn({ type: 'image', mimeType: 'image/jpeg', base64Data: 'aGVsbG8=' });
    expect(image).toMatchObject({ kind: 'image', name: 'image.jpg', bytes: 5 });
    expect(image.previewUrl).toBe('data:image/jpeg;base64,aGVsbG8=');
    expect(image.attachment.name).toBe('image.jpg');
    const file = attachmentFromTurn({ type: 'file', name: 'a.csv', mimeType: 'text/csv', base64Data: 'aGk=' });
    expect(file).toMatchObject({ kind: 'file', name: 'a.csv', bytes: 2 });
    expect(file.previewUrl).toBeUndefined();
  });

  it('writes each chip as its [name] where only words go', () => {
    expect(plainTextOf(`in ${M} and ${M}`, [{ name: 'a.png' }, { name: 'b.pdf' }])).toBe(
      'in [a.png] and [b.pdf]',
    );
  });

  it('keeps attachments in memory by key, and forgets them when there are none', () => {
    const a = attachmentFromTurn({ mimeType: 'image/png', base64Data: 'AAAA', name: 'x.png' });
    const key = savedDraftKey('tab-1', `look ${M}`);
    keepAttachments(key, [a] as ComposerAttachment[]);
    expect(keptAttachments(key)?.map((k) => k.name)).toEqual(['x.png']);
    keepAttachments(key, []);
    expect(keptAttachments(key)).toBeUndefined();
    expect(savedDraftKey('tab-1', 'a')).not.toBe(savedDraftKey('tab-2', 'a'));
  });

  it('says an extension and a size', () => {
    expect(extensionOf('image/png')).toBe('.png');
    expect(extensionOf('image/jpeg')).toBe('.jpg');
    expect(extensionOf('image/svg+xml')).toBe('.svg');
    expect(base64Bytes('aGk=')).toBe(2);
    expect(base64Bytes('')).toBe(0);
  });
});
