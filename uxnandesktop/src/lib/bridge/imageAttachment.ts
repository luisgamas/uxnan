// Images attached to a chat message (`turn/send { attachments }`), prepared the
// way the phone prepares them: at most 2048 px on the long edge, re-encoded as
// JPEG at 85 % when larger than that or than a few megabytes, and carried
// inline as base64 — the bridge writes them where the agent can open them.

import type { TurnAttachment } from '$shared/models/workspace';

/** The long edge an attached image is scaled down to. */
export const MAX_IMAGE_EDGE = 2048;

/** Above this many bytes an image is re-encoded even if small enough in pixels. */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** How many images one message may carry — the phone's limit too. */
export const MAX_IMAGES = 10;

/** An image waiting in the composer: what is sent, plus its preview. */
export interface ComposerImage {
  id: string;
  name: string;
  /** A `data:` URL for the thumbnail. */
  previewUrl: string;
  attachment: TurnAttachment;
}

/** The MIME type and base64 payload of a `data:` URL, or `undefined`. */
export function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match || !match[1]?.startsWith('image/')) return undefined;
  return { mimeType: match[1], base64: match[2] ?? '' };
}

/** How many bytes a base64 payload decodes to. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** The size an image of [width] × [height] is scaled to (never up). */
export function fitWithin(width: number, height: number, edge = MAX_IMAGE_EDGE) {
  const long = Math.max(width, height);
  if (long <= edge) return { width, height };
  const scale = edge / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** An image from a `data:` URL (a picked file, a pasted blob), ready to send. */
export async function imageFromDataUrl(dataUrl: string, name: string): Promise<ComposerImage> {
  const parts = splitDataUrl(dataUrl);
  if (!parts) throw new Error(`not an image: ${name}`);
  const size = await imageSize(dataUrl);
  const fitted = size ? fitWithin(size.width, size.height) : undefined;
  const tooLarge =
    base64Bytes(parts.base64) > MAX_IMAGE_BYTES ||
    (size !== undefined && fitted !== undefined && fitted.width !== size.width);
  const finalUrl =
    tooLarge && size && fitted ? (reencode(dataUrl, fitted) ?? dataUrl) : dataUrl;
  const final = splitDataUrl(finalUrl) ?? parts;
  const dims = fitted ?? size;
  return {
    id: crypto.randomUUID(),
    name,
    previewUrl: finalUrl,
    attachment: {
      type: 'image',
      mimeType: final.mimeType,
      base64Data: final.base64,
      ...(dims ? { width: dims.width, height: dims.height } : {}),
    },
  };
}

/** A pasted or dropped image file, ready to send. */
export function imageFromBlob(blob: Blob, name = 'image'): Promise<ComposerImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return reject(new Error('unreadable image'));
      imageFromDataUrl(reader.result, name).then(resolve, reject);
    };
    reader.onerror = () => reject(reader.error ?? new Error('unreadable image'));
    reader.readAsDataURL(blob);
  });
}

// ---- pixels: need a real image decoder (absent under jsdom → left as is) ----

let decoded: { url: string; image: HTMLImageElement } | undefined;

function imageSize(dataUrl: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(undefined);
    const image = new Image();
    image.onload = () => {
      decoded = { url: dataUrl, image };
      resolve(
        image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : undefined,
      );
    };
    image.onerror = () => resolve(undefined);
    image.src = dataUrl;
  });
}

function reencode(dataUrl: string, size: { width: number; height: number }): string | undefined {
  if (decoded?.url !== dataUrl || typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.drawImage(decoded.image, 0, 0, size.width, size.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
