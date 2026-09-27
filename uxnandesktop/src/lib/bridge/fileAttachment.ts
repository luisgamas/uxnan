// Files attached to a chat message (`turn/send { attachments }` with
// `type: 'file'`): any file, carried inline as base64 with its name — the
// bridge writes it under that name where the agent can open it. Images keep
// their own path (`imageAttachment.ts`), scaled like the phone's.

import type { TurnAttachment } from '$shared/models/workspace';

/** The largest file a message carries: the bridge's `MAX_ATTACHMENT_BYTES`. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** How many files one message may carry. */
export const MAX_FILES = 10;

/** A file waiting in the composer. */
export interface ComposerFile {
  id: string;
  name: string;
  bytes: number;
  attachment: TurnAttachment;
}

/** What the desktop's `fs_read_attachment` answers for a picked file. */
export interface ReadFile {
  name: string;
  mimeType: string;
  base64Data: string;
  bytes: number;
}

/** Extensions sent as images (scaled, shown as thumbnails) when the agent takes them. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** Whether a file of this name goes as an image. */
export function isImageName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return name.includes('.') && IMAGE_EXTENSIONS.has(ext);
}

/** A file read from disk, ready to send. */
export function fileFromRead(read: ReadFile): ComposerFile {
  return {
    id: crypto.randomUUID(),
    name: read.name,
    bytes: read.bytes,
    attachment: {
      type: 'file',
      name: read.name,
      mimeType: read.mimeType || 'application/octet-stream',
      base64Data: read.base64Data,
    },
  };
}

/** A dropped or pasted file, ready to send; rejects one past {@link MAX_FILE_BYTES}. */
export async function fileFromBlob(blob: Blob, name: string): Promise<ComposerFile> {
  if (blob.size > MAX_FILE_BYTES) {
    throw new Error(`${name} is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB`);
  }
  return fileFromRead({
    name,
    mimeType: blob.type || 'application/octet-stream',
    base64Data: toBase64(new Uint8Array(await blob.arrayBuffer())),
    bytes: blob.size,
  });
}

/** Base64 of [bytes], in chunks so a large file never overflows the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** A size for people: `980 B`, `12 KB`, `3.4 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
