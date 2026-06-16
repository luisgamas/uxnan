/**
 * Turn attachment delivery.
 *
 * The phone sends inline image attachments on `turn/send { attachments }`. No
 * agent CLI accepts inline base64 over the headless stdio path, but every
 * supported agent (Claude, Codex, OpenCode, pi, Gemini) can OPEN a local file
 * with its own file/vision tools. So the bridge materializes each attachment to
 * a temp file and references the absolute paths in the prompt — CLI-agnostic,
 * no per-adapter image handling required.
 *
 * Source: architecture/02a-system-architecture.md §5.8 (agent turns) +
 * uxnanmobile/FOR-DEV.md → Conversation / timeline → Attach (the contract the
 * phone wired ahead of the bridge).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TurnAttachment } from '@uxnan/shared';

/** Extension for a known image MIME type (no leading dot). */
function extensionFor(mimeType: string): string {
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

export interface MaterializedAttachments {
  /** Absolute paths of the files written to disk. */
  paths: string[];
  /** A prompt note referencing the paths, or `''` when nothing was written. */
  note: string;
}

/**
 * Writes each inline attachment to a temp file under
 * `<tmp>/uxnan-attachments/<turnId>/` and returns the absolute paths plus a
 * ready-to-append prompt note. Tolerant: attachments without usable
 * `base64Data` are skipped (an attachment that is only a workspace `path` is
 * passed through by reference, since the agent can already read it). Never
 * throws on a single bad attachment — best-effort delivery.
 */
export async function materializeAttachments(
  attachments: readonly TurnAttachment[],
  turnId: string,
  baseDir: string = join(tmpdir(), 'uxnan-attachments'),
): Promise<MaterializedAttachments> {
  if (attachments.length === 0) return { paths: [], note: '' };

  const dir = join(baseDir, sanitizeSegment(turnId));
  const paths: string[] = [];
  let madeDir = false;

  for (let i = 0; i < attachments.length; i += 1) {
    const att = attachments[i];
    if (!att) continue;
    // An attachment that is already an on-disk workspace file: reference it
    // directly (no need to copy), the agent can open it in place.
    if (!att.base64Data && att.path) {
      paths.push(att.path);
      continue;
    }
    if (!att.base64Data) continue;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(att.base64Data, 'base64');
    } catch {
      continue;
    }
    if (bytes.length === 0) continue;
    if (!madeDir) {
      await mkdir(dir, { recursive: true });
      madeDir = true;
    }
    const file = join(dir, `image-${i}.${extensionFor(att.mimeType ?? 'image/png')}`);
    try {
      await writeFile(file, bytes);
      paths.push(file);
    } catch {
      // Best-effort: a single write failure must not abort the turn.
    }
  }

  if (paths.length === 0) return { paths: [], note: '' };
  const label = paths.length > 1 ? 'images' : 'image';
  const list = paths.map((p) => `- ${p}`).join('\n');
  const note = `[Attached ${label} (open with your file/vision tools):\n${list}\n]`;
  return { paths, note };
}

/** Strip path separators / unsafe chars from a path segment. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'turn';
}
