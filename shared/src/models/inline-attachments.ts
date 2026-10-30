/**
 * Where a user message's images and files sit in its text.
 *
 * A message is written as one sentence with its attachments inside it — "in
 * this image ⟨a.png⟩ you can see X, and in this one ⟨b.png⟩ Y" — and the agent
 * must receive the same interleaving, or it cannot tell which part of the
 * sentence each picture belongs to. So the text carries one
 * {@link ATTACHMENT_MARKER} (U+FFFC OBJECT REPLACEMENT CHARACTER, Unicode's own
 * "an inline object goes here") per attachment, in order: the n-th marker is
 * `attachments[n - 1]`. The marker is one character, so a composer that draws
 * it as a chip moves the caret over it and deletes it in one keystroke, and
 * every position in the text stays a plain string index.
 *
 * The rule holds for `turn/send` (`TurnSendParams.text`, or a command's
 * `args`) and for the stored message (`Message.content` with
 * `Message.attachments`), so the phone and the desktop draw a sent message the
 * same way it was written. The bridge refuses a `turn/send` whose markers do
 * not match its attachments one for one (see {@link inlineAttachmentsError}).
 *
 * Source: architecture/02b-contracts-and-requirements.md (TurnSendParams,
 * TurnAttachment) and architecture/02a-system-architecture.md §5.8.12.
 */

/** The character that stands for one attachment in a message's text (U+FFFC). */
export const ATTACHMENT_MARKER = '￼';

/** How many attachment markers [text] holds. */
export function countAttachmentMarkers(text: string): number {
  let count = 0;
  for (const ch of text) if (ch === ATTACHMENT_MARKER) count += 1;
  return count;
}

/**
 * [text] cut at its markers: `n` markers give `n + 1` pieces, so attachment
 * `i` sits between piece `i` and piece `i + 1`.
 */
export function splitAtAttachmentMarkers(text: string): string[] {
  return text.split(ATTACHMENT_MARKER);
}

/** [text] without any attachment marker — for text pasted or typed from elsewhere. */
export function stripAttachmentMarkers(text: string): string {
  return text.split(ATTACHMENT_MARKER).join('');
}

/**
 * Why [text] cannot carry [attachmentCount] attachments, or `undefined` when
 * it can: it needs exactly one marker per attachment.
 */
export function inlineAttachmentsError(text: string, attachmentCount: number): string | undefined {
  const markers = countAttachmentMarkers(text);
  if (markers === attachmentCount) return undefined;
  return `the message has ${markers} attachment marker(s) (U+FFFC) for ${attachmentCount} attachment(s); each attachment needs exactly one, where it sits in the text`;
}

/**
 * [text] for a place that shows only words (a title, a preview, the
 * clipboard): each marker becomes `[name]` of the attachment it stands for —
 * [names] in order, `fallback` for one without a name or past the end.
 */
export function inlineAttachmentsPlainText(
  text: string,
  names: readonly (string | undefined)[],
  fallback = 'attachment',
): string {
  const pieces = splitAtAttachmentMarkers(text);
  let out = pieces[0] ?? '';
  for (let i = 1; i < pieces.length; i += 1) {
    const name = names[i - 1]?.trim();
    out += `[${name && name.length > 0 ? name : fallback}]${pieces[i] ?? ''}`;
  }
  return out;
}
