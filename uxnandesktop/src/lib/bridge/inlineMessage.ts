// A user message as it is drawn: its text, cut where its images and files sit
// (one `ATTACHMENT_MARKER` per attachment, in order — `Message.content` with
// `Message.attachments`), so the bubble shows each one inline, exactly where
// it was written. The phone draws the same message the same way.
//
// Drawing is tolerant, never a second format: attachments past the markers (a
// message stored before markers existed) follow the text, and a marker with
// no attachment draws nothing.

import {
  inlineAttachmentsPlainText,
  splitAtAttachmentMarkers,
} from '$shared/models/inline-attachments';
import type { MessageAttachment } from '$shared/models/thread';
import type { TurnAttachment } from '$shared/models/workspace';
import { extensionOf } from './composerAttachments';

/** One image or file of a drawn message, and how to get its bytes. */
export interface ChatChip {
  id: string;
  name: string;
  kind: 'image' | 'file';
  mimeType: string;
  /** Its bytes as a `data:` URL — at hand for a message being sent, asked
   *  of the bridge (`turn/attachment`, kept once fetched) for a stored one. */
  load: () => Promise<string>;
}

/** The name an attachment is shown under (one sent without a name gets its kind's). */
function nameOf(name: string | undefined, image: boolean, mimeType: string): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return image ? `image${extensionOf(mimeType)}` : 'file';
}

/** A stored message's attachments as chips, their bytes asked with [load] (by id). */
export function sentChips(
  attachments: readonly MessageAttachment[],
  load: (attachmentId: string) => Promise<string>,
): ChatChip[] {
  return attachments.map((a) => {
    const image = a.mimeType.startsWith('image/');
    return {
      id: a.id,
      name: nameOf(a.name, image, a.mimeType),
      kind: image ? 'image' : 'file',
      mimeType: a.mimeType,
      load: () => load(a.id),
    };
  });
}

/** The attachments of a message being sent (bytes at hand) as chips; [key] makes their ids. */
export function pendingChips(attachments: readonly TurnAttachment[], key: string): ChatChip[] {
  return attachments.map((a, i) => {
    const image = a.mimeType.startsWith('image/');
    const url = `data:${a.mimeType};base64,${a.base64Data}`;
    return {
      id: `${key}-${i}`,
      name: nameOf(a.name, image, a.mimeType),
      kind: image ? 'image' : 'file',
      mimeType: a.mimeType,
      load: () => Promise.resolve(url),
    };
  });
}

/**
 * A message's words for a place that shows only words (↑ recall, the clipboard,
 * a preview): each attachment as `[name]` where it sat.
 */
export function messagePlainText(
  text: string,
  attachments: readonly { name?: string; mimeType: string }[],
): string {
  return inlineAttachmentsPlainText(
    text,
    attachments.map((a) => nameOf(a.name, a.mimeType.startsWith('image/'), a.mimeType)),
  );
}

/** One piece of a drawn message. */
export type MessagePiece<A> =
  | { kind: 'text'; text: string }
  | {
      kind: 'attachment';
      attachment: A;
      /** Its place in the message's attachments. */
      index: number;
      /** It has no marker: it follows the text instead of sitting in it. */
      trailing: boolean;
    };

/** [text] and [attachments] as the pieces a bubble draws, in order. */
export function messagePieces<A>(text: string, attachments: readonly A[]): MessagePiece<A>[] {
  const pieces: MessagePiece<A>[] = [];
  const parts = splitAtAttachmentMarkers(text);
  parts.forEach((part, i) => {
    if (part !== '') pieces.push({ kind: 'text', text: part });
    if (i === parts.length - 1) return;
    const attachment = attachments[i];
    if (attachment !== undefined) pieces.push({ kind: 'attachment', attachment, index: i, trailing: false });
  });
  for (let i = parts.length - 1; i < attachments.length; i += 1) {
    const attachment = attachments[i];
    if (attachment !== undefined) pieces.push({ kind: 'attachment', attachment, index: i, trailing: true });
  }
  return pieces;
}
