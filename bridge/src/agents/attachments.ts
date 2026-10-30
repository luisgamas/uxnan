/**
 * Turn attachment delivery: the images and files of a user message, handed to
 * the agent **where the person put them in the sentence**.
 *
 * A message arrives as text with one `ATTACHMENT_MARKER` per attachment, in
 * order (`@uxnan/shared` `models/inline-attachments.ts`). The agent must get
 * the same interleaving — "in this image ⟨a⟩ you can see X, and in this one ⟨b⟩
 * Y" only means something if it knows which picture is which — so this module
 * turns the message into one prompt for every agent:
 *
 * 1. every attachment is written into the agent's folder for the turn
 *    (`<cwd>/.uxnan-attachments/<turnId>/<n>/<name>`), because every wired
 *    agent can open a file there with its own tools — and none can open one
 *    outside its workspace (verified: Claude answers "the read was blocked by
 *    a permission prompt" for the same image under the OS temp dir). A turn
 *    with no `cwd` uses the adapter's own folder (`IAgentAdapter.defaultCwd`);
 *    the temp dir is a last resort. The folder is removed when the turn ends
 *    (see AgentManager);
 * 2. each marker becomes a numbered label at its place — `[Image 1: a.png]`,
 *    `[File 1: b.pdf]` — and a closing note maps every label to its file;
 * 3. for an adapter whose CLI takes images itself
 *    (`IAgentAdapter.takesInlineImages`) the same prompt is also cut into
 *    ordered parts with each image right after its label
 *    (`SendTurnOptions.input`), so the model sees the picture in place; the
 *    note then says the image came with the message and its file is there for
 *    file work, instead of asking the agent to open it.
 *
 * Source: architecture/02a-system-architecture.md §5.8.12; per-agent delivery
 * in bridge/docs/agents.md → *Attachments in the sentence*.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { splitAtAttachmentMarkers, type TurnAttachment, type TurnInputPart } from '@uxnan/shared';

/** Sub-directory (under the thread cwd) the bridge drops turn attachments into. */
export const ATTACHMENTS_DIRNAME = '.uxnan-attachments';

/**
 * The image types a CLI's native image input takes (the Anthropic, OpenAI and
 * Gemini APIs all accept these four). Any other image — HEIC, BMP — is sent as
 * a file to open, never inline, so no CLI is handed bytes its model refuses.
 */
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** One attachment, written and labelled for the turn. */
export interface PreparedAttachment {
  attachment: TurnAttachment;
  kind: 'image' | 'file';
  /** Its label in the prompt, e.g. `[Image 1: a.png]`. */
  label: string;
  /** Its number among the attachments of its kind (1-based). */
  number: number;
  /** Absolute path of the copy in the agent's folder; absent when writing it failed. */
  path?: string;
  /** How the prompt names that path: relative to the cwd when it lies inside. */
  reference?: string;
  /** Whether the CLI gets this image as its own image input. */
  inline: boolean;
}

/** The attachments of a turn, ready to be named in its prompt. */
export interface PreparedAttachments {
  items: PreparedAttachment[];
  /** Absolute directory the files were written under (removed on turn end). */
  dir?: string;
}

export interface PrepareOptions {
  /**
   * The agent's working directory. When set, files are written under
   * `<cwd>/.uxnan-attachments/<turnId>/` and referenced by a cwd-relative
   * path; when unset, under the OS temp dir with an absolute reference.
   */
  cwd?: string;
  /** Whether the adapter takes images itself (`IAgentAdapter.takesInlineImages`). */
  inlineImages?: boolean;
}

/**
 * Writes each attachment into the agent's folder for the turn and labels it.
 * Best-effort per file: one that cannot be written is still labelled (an
 * inline image still reaches the agent), and the note says it is not on disk.
 */
export async function prepareAttachments(
  attachments: readonly TurnAttachment[],
  turnId: string,
  options: PrepareOptions = {},
): Promise<PreparedAttachments> {
  if (attachments.length === 0) return { items: [] };
  const cwd = options.cwd;
  const baseDir = cwd ? join(cwd, ATTACHMENTS_DIRNAME) : join(tmpdir(), 'uxnan-attachments');
  const dir = join(baseDir, sanitizeSegment(turnId));
  const items: PreparedAttachment[] = [];
  const counts = { image: 0, file: 0 };
  let madeDir = false;

  for (const [index, attachment] of attachments.entries()) {
    const kind = attachment.type === 'file' ? 'file' : 'image';
    counts[kind] += 1;
    const number = counts[kind];
    const name = sanitizeFileName(attachment.name);
    const item: PreparedAttachment = {
      attachment,
      kind,
      number,
      label: attachmentLabel(kind, number, attachment.name),
      inline:
        kind === 'image' &&
        options.inlineImages === true &&
        INLINE_IMAGE_TYPES.has(attachment.mimeType.toLowerCase()),
    };
    items.push(item);
    const bytes = Buffer.from(attachment.base64Data, 'base64');
    if (bytes.length === 0) continue;
    // Each in a folder of its own, under its own name — the person and the
    // agent talk about it by that name — so two named alike never collide.
    const folder = join(dir, String(index + 1));
    const file = join(
      folder,
      name ??
        (kind === 'image'
          ? `image-${number}.${imageExtension(attachment.mimeType)}`
          : `file-${number}${fileExtension(attachment.mimeType)}`),
    );
    try {
      if (!madeDir) {
        await mkdir(dir, { recursive: true });
        madeDir = true;
      }
      await mkdir(folder, { recursive: true });
      await writeFile(file, bytes);
      item.path = file;
      item.reference = referencePath(file, cwd);
    } catch {
      // Best-effort: a single write failure must not abort the turn.
    }
  }
  return { items, ...(madeDir ? { dir } : {}) };
}

/** The label an attachment has in the prompt: `[Image 2: a.png]`, `[File 1]`. */
export function attachmentLabel(kind: 'image' | 'file', number: number, name?: string): string {
  const noun = kind === 'image' ? 'Image' : 'File';
  const clean = (name ?? '')
    .replace(/[\u0000-\u001f[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return clean.length > 0 ? `[${noun} ${number}: ${clean}]` : `[${noun} ${number}]`;
}

/**
 * [text] with each marker replaced by its attachment's label, in order. A
 * marker past the last attachment is dropped; the bridge refuses a message
 * whose markers do not match its attachments, so neither happens on a turn
 * that came through `turn/send`.
 */
export function labelMarkers(text: string, prepared: PreparedAttachments): string {
  const pieces = splitAtAttachmentMarkers(text);
  let out = pieces[0] ?? '';
  for (let i = 1; i < pieces.length; i += 1) {
    out += `${prepared.items[i - 1]?.label ?? ''}${pieces[i] ?? ''}`;
  }
  return out;
}

/**
 * The note that closes the prompt: every label, the file it is, and how the
 * agent gets at it. `''` when the turn has no attachments.
 */
export function attachmentNote(prepared: PreparedAttachments): string {
  if (prepared.items.length === 0) return '';
  const lines = prepared.items.map((item) => {
    const what = item.label.slice(1, -1);
    if (item.reference === undefined) {
      return item.inline
        ? `- ${what}: sent with this message as an image (no copy could be saved on disk)`
        : `- ${what}: could not be saved on disk`;
    }
    if (item.inline) {
      return `- ${what}: sent with this message as an image, right after its label; its file is ${item.reference}`;
    }
    return item.kind === 'image'
      ? `- ${what}: ${item.reference} (open it with your file/vision tools to see it)`
      : `- ${what}: ${item.reference} (open it with your file tools)`;
  });
  return `[Attachments — each label in the message above is one of these:\n${lines.join('\n')}\n]`;
}

/**
 * The prompt cut into ordered parts with each inline image right after the
 * first occurrence of its label in [message] (the person's words, labelled),
 * and [note] closing the last text part. An image whose label is not in the
 * message (a command template that dropped its arguments) goes at the end of
 * the message. `undefined` when no image is inline.
 */
export function interleaveImages(
  message: string,
  note: string,
  prepared: PreparedAttachments,
): TurnInputPart[] | undefined {
  const inline = prepared.items.filter((item) => item.inline);
  if (inline.length === 0) return undefined;
  const parts: TurnInputPart[] = [];
  const trailing: PreparedAttachment[] = [];
  let cursor = 0;
  for (const item of inline) {
    const at = message.indexOf(item.label, cursor);
    if (at < 0) {
      trailing.push(item);
      continue;
    }
    const end = at + item.label.length;
    parts.push({ type: 'text', text: message.slice(cursor, end) });
    parts.push(imagePart(item));
    cursor = end;
  }
  const rest = message.slice(cursor);
  if (trailing.length > 0) {
    if (rest.length > 0) parts.push({ type: 'text', text: rest });
    for (const item of trailing) parts.push(imagePart(item));
    if (note.length > 0) parts.push({ type: 'text', text: `\n\n${note}` });
  } else {
    const tail = note.length > 0 ? `${rest}\n\n${note}` : rest;
    if (tail.length > 0) parts.push({ type: 'text', text: tail });
  }
  return parts;
}

/** [message] and [note] joined the way {@link interleaveImages} joins them. */
export function withNote(message: string, note: string): string {
  if (note.length === 0) return message;
  return message.length > 0 ? `${message}\n\n${note}` : note;
}

function imagePart(item: PreparedAttachment): TurnInputPart {
  const name = item.attachment.name;
  return {
    type: 'image',
    label: item.label,
    ...(name !== undefined ? { name } : {}),
    mimeType: item.attachment.mimeType,
    base64Data: item.attachment.base64Data,
    ...(item.path !== undefined ? { path: item.path } : {}),
  };
}

/** Extension for an image MIME type (no leading dot). */
function imageExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/heic':
      return 'heic';
    case 'image/bmp':
      return 'bmp';
    default:
      return 'bin';
  }
}

/**
 * Reference path used in the prompt: relative to `cwd` (POSIX separators) when
 * the file lives inside it, otherwise the path as-is. Relative keeps the
 * reference inside the agent's sandbox.
 */
function referencePath(absPath: string, cwd: string | undefined): string {
  if (!cwd) return absPath;
  const rel = relative(cwd, absPath);
  if (!rel || rel.startsWith('..')) return absPath;
  return rel.split(sep).join('/');
}

/**
 * A file name safe to write: its last segment, without control characters or
 * characters Windows refuses, trimmed of dots and spaces at the end. Undefined
 * when nothing usable is left.
 */
export function sanitizeFileName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 120);
  return clean.length > 0 && clean !== '.' && clean !== '..' ? clean : undefined;
}

/** A likely extension (with its dot) for a MIME type with no file name. */
function fileExtension(mimeType: string | undefined): string {
  const known: Record<string, string> = {
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'text/csv': '.csv',
    'application/json': '.json',
    'application/zip': '.zip',
  };
  return known[(mimeType ?? '').toLowerCase()] ?? '';
}

/** Strip path separators / unsafe chars from a path segment. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'turn';
}
