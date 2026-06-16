/**
 * Turn attachment delivery.
 *
 * The phone sends inline image attachments on `turn/send { attachments }`. No
 * agent CLI accepts inline base64 over the headless stdio path, but every
 * supported agent (Claude, Codex, OpenCode, pi, Gemini) can OPEN a local file
 * with its own file/vision tools. So the bridge materializes each attachment to
 * a file and references the path in the prompt — CLI-agnostic, no per-adapter
 * image handling required.
 *
 * IMPORTANT: the file is written **inside the agent's working directory**
 * (`<cwd>/.uxnan-attachments/<turnId>/`) and referenced by a **cwd-relative**
 * path, because sandboxed agents confine file reads to the workspace (Gemini
 * `--approval-mode`, Codex `workspace-write`, Claude `acceptEdits`) and reject a
 * path outside it. The dir is cleaned up when the turn ends (see AgentManager).
 *
 * Source: architecture/02a-system-architecture.md §5.8 (agent turns) +
 * uxnanmobile/FOR-DEV.md → Conversation / timeline → Attach.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { TurnAttachment } from '@uxnan/shared';

/** Sub-directory (under the thread cwd) the bridge drops turn attachments into. */
export const ATTACHMENTS_DIRNAME = '.uxnan-attachments';

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
  /** Absolute paths of the files written to disk (for the turn-end cleanup). */
  paths: string[];
  /** Absolute directory the files were written under (removed on turn end). */
  dir?: string;
  /** A prompt note referencing the paths, or `''` when nothing was written. */
  note: string;
}

export interface MaterializeOptions {
  /**
   * The agent's working directory. When set, files are written under
   * `<cwd>/.uxnan-attachments/<turnId>/` and referenced by a cwd-relative path
   * so sandboxed agents can open them. When unset, falls back to the OS temp
   * dir with an absolute reference.
   */
  cwd?: string;
}

/**
 * Writes each inline attachment to a file under the thread's working directory
 * and returns the absolute paths plus a ready-to-append prompt note (which
 * references the files by a cwd-relative path). Tolerant: attachments without
 * usable `base64Data` are skipped (an attachment that is only a workspace
 * `path` is referenced by that path). Never throws on a single bad attachment.
 */
export async function materializeAttachments(
  attachments: readonly TurnAttachment[],
  turnId: string,
  options: MaterializeOptions = {},
): Promise<MaterializedAttachments> {
  if (attachments.length === 0) return { paths: [], note: '' };

  const cwd = options.cwd;
  const baseDir = cwd ? join(cwd, ATTACHMENTS_DIRNAME) : join(tmpdir(), 'uxnan-attachments');
  const dir = join(baseDir, sanitizeSegment(turnId));
  const paths: string[] = [];
  const refs: string[] = [];
  let madeDir = false;

  for (let i = 0; i < attachments.length; i += 1) {
    const att = attachments[i];
    if (!att) continue;
    // An attachment that is already an on-disk workspace file: reference it
    // directly (no need to copy), the agent can open it in place.
    if (!att.base64Data && att.path) {
      paths.push(att.path);
      refs.push(referencePath(att.path, cwd));
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
      refs.push(referencePath(file, cwd));
    } catch {
      // Best-effort: a single write failure must not abort the turn.
    }
  }

  if (paths.length === 0) return { paths: [], note: '' };
  const label = paths.length > 1 ? 'images' : 'image';
  const list = refs.map((p) => `- ${p}`).join('\n');
  const note = `[Attached ${label} (open with your file/vision tools):\n${list}\n]`;
  return { paths, ...(madeDir ? { dir } : {}), note };
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

/** Strip path separators / unsafe chars from a path segment. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'turn';
}
