// The images and files a chat message carries, as the composer holds them:
// each one is a chip inside the text, where it was pasted, dropped or picked,
// and the text holds one `ATTACHMENT_MARKER` (U+FFFC) per chip, in order — the
// message is sent exactly that way (`turn/send { text, attachments }`, the
// n-th marker is the n-th attachment) so the agent knows which part of the
// sentence each one belongs to (`shared/src/models/inline-attachments.ts`).
//
// What is written stays as long as the app runs: the draft's text is saved
// with the tab (`ChatTab.draft`), its attachments here, in memory — the bytes
// are too large for the layout file. A draft that comes back without them
// (after a restart) drops its markers, which the bridge would refuse.

import {
  ATTACHMENT_MARKER,
  countAttachmentMarkers,
  inlineAttachmentsPlainText,
  stripAttachmentMarkers,
} from '$shared/models/inline-attachments';
import type { TurnAttachment } from '$shared/models/workspace';

/** One attachment in the composer: what is sent, plus what its chip shows. */
export interface ComposerAttachment {
  /** Stable id of its chip (never sent). */
  id: string;
  kind: 'image' | 'file';
  /** The name its chip shows and the agent is told. */
  name: string;
  /** Decoded size in bytes. */
  bytes: number;
  /** A `data:` URL of an image, for its thumbnail and preview. */
  previewUrl?: string;
  attachment: TurnAttachment;
}

/** How many bytes a base64 payload decodes to. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** A sent (or about to be sent) attachment back in the composer. */
export function attachmentFromTurn(attachment: TurnAttachment): ComposerAttachment {
  const image = attachment.type !== 'file';
  const name = attachment.name ?? (image ? `image${extensionOf(attachment.mimeType)}` : 'file');
  return {
    id: crypto.randomUUID(),
    kind: image ? 'image' : 'file',
    name,
    bytes: base64Bytes(attachment.base64Data),
    ...(image ? { previewUrl: `data:${attachment.mimeType};base64,${attachment.base64Data}` } : {}),
    attachment: { ...attachment, name },
  };
}

/** A likely extension (with its dot) for an image MIME type. */
export function extensionOf(mimeType: string): string {
  const sub = mimeType.toLowerCase().split('/')[1] ?? '';
  if (sub === 'jpeg') return '.jpg';
  if (sub === 'svg+xml') return '.svg';
  return /^[a-z0-9]+$/.test(sub) ? `.${sub}` : '';
}

/** Names a pasted image arrives with when it has none of its own. */
const GENERIC_IMAGE_NAMES = /^(image|blob|untitled|screenshot)?(\.[a-z0-9]+)?$/i;

/**
 * The name a pasted image gets: its own when it has a real one, else
 * `image-<n>.<ext>` with the first `n` no other chip in [taken] uses — so two
 * screenshots in one sentence are told apart, by the person and by the agent.
 */
export function pastedImageName(
  name: string | undefined,
  mimeType: string,
  taken: Iterable<string>,
): string {
  const trimmed = name?.trim() ?? '';
  if (trimmed.length > 0 && !GENERIC_IMAGE_NAMES.test(trimmed)) return trimmed;
  const used = new Set(taken);
  const ext = /\.[a-z0-9]+$/i.exec(trimmed)?.[0] ?? (extensionOf(mimeType) || '.png');
  for (let n = 1; ; n += 1) {
    const candidate = `image-${n}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** [name] shortened in the middle to [max] characters, keeping its extension. */
export function shortName(name: string, max = 28): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const room = Math.max(2, max - ext.length - 1);
  const head = Math.ceil(room / 2);
  const tail = room - head;
  const stem = ext ? name.slice(0, dot) : name;
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`;
}

/** [text] with each marker as `[name]` of its attachment: for the clipboard and previews. */
export function plainTextOf(
  text: string,
  attachments: readonly { name?: string }[],
): string {
  return inlineAttachmentsPlainText(
    text,
    attachments.map((a) => a.name),
  );
}

/**
 * A draft's text with the attachments it still has: unchanged when there is
 * one per marker, otherwise without its markers (and so without attachments)
 * — a text whose bytes are gone must not reach the bridge with markers.
 */
export function reconcileDraft<T>(
  text: string,
  attachments: readonly T[] | undefined,
): { text: string; attachments: T[] } {
  const list = attachments ?? [];
  if (countAttachmentMarkers(text) === list.length) return { text, attachments: [...list] };
  return { text: stripAttachmentMarkers(text), attachments: [] };
}

// ---- in memory, by key: a tab's draft and its saved drafts ----

const memory = new Map<string, ComposerAttachment[]>();

/** Keep [attachments] for the draft under [key] (none forgets it). */
export function keepAttachments(key: string, attachments: readonly ComposerAttachment[]): void {
  if (attachments.length === 0) memory.delete(key);
  else memory.set(key, [...attachments]);
}

/** The attachments kept under [key], if any. */
export function keptAttachments(key: string): ComposerAttachment[] | undefined {
  const kept = memory.get(key);
  return kept ? [...kept] : undefined;
}

/** The key a saved (set-aside) draft's attachments are kept under. */
export function savedDraftKey(tabId: string, text: string): string {
  return `${tabId}\u0000saved\u0000${text}`;
}

export { ATTACHMENT_MARKER };
