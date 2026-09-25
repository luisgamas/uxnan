import { describe, expect, it } from 'vitest';
import { base64Bytes, fitWithin, imageFromDataUrl, splitDataUrl } from './imageAttachment';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('imageAttachment', () => {
  it('reads an image data URL, and nothing else', () => {
    expect(splitDataUrl(PNG)).toEqual({ mimeType: 'image/png', base64: 'iVBORw0KGgo=' });
    expect(splitDataUrl('data:text/plain;base64,aGk=')).toBeUndefined();
    expect(splitDataUrl('not a url')).toBeUndefined();
  });

  it('counts the bytes a payload decodes to', () => {
    expect(base64Bytes('aGk=')).toBe(2);
    expect(base64Bytes('aGVsbG8=')).toBe(5);
    expect(base64Bytes('YWJj')).toBe(3);
  });

  it('scales the long edge down to 2048, never up', () => {
    expect(fitWithin(4096, 1024)).toEqual({ width: 2048, height: 512 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 683, height: 2048 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('prepares an attachment with its preview', async () => {
    const image = await imageFromDataUrl(PNG, 'shot.png');
    expect(image.name).toBe('shot.png');
    expect(image.previewUrl).toBe(PNG);
    expect(image.attachment).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      base64Data: 'iVBORw0KGgo=',
    });
    await expect(imageFromDataUrl('data:text/plain;base64,aGk=', 'x')).rejects.toThrow();
  });
});
