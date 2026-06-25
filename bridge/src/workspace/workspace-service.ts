/**
 * Workspace file operations, confined to the project root and stripped of
 * sensitive files (see {@link resolveWithinRoot}). Paths returned to the phone
 * are relative to the project root, never absolute.
 *
 * Source: architecture/02a-system-architecture.md §5.8.7 / §5.8.9.
 */
import { readFile, readdir, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import type {
  ApplyResult,
  FileContent,
  ImageContent,
  PatchChange,
  WorkspaceEntry,
  WorkspaceListing,
} from '@uxnan/shared';
import { isSensitiveName, resolveWithinRoot } from './path-guard.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

export class WorkspaceService {
  async readFile(root: string, relPath: string): Promise<FileContent> {
    const abs = resolveWithinRoot(root, relPath);
    await this.#assertReadableFile(abs, MAX_FILE_BYTES);
    const buffer = await readFile(abs);
    const path = toRelative(root, abs);
    if (isBinary(buffer)) {
      return { path, content: buffer.toString('base64'), encoding: 'base64' };
    }
    return { path, content: buffer.toString('utf-8'), encoding: 'utf-8' };
  }

  async readImage(root: string, relPath: string): Promise<ImageContent> {
    const abs = resolveWithinRoot(root, relPath);
    const mimeType = IMAGE_MIME[extname(abs).toLowerCase()];
    if (!mimeType) {
      throw RpcError.invalidParams('not a supported image type');
    }
    await this.#assertReadableFile(abs, MAX_IMAGE_BYTES);
    const buffer = await readFile(abs);
    return { path: toRelative(root, abs), base64Data: buffer.toString('base64'), mimeType };
  }

  async list(root: string): Promise<WorkspaceListing> {
    const resolvedRoot = resolve(root);
    let dirents;
    try {
      dirents = await readdir(resolvedRoot, { withFileTypes: true });
    } catch {
      throw new RpcError(JsonRpcErrorCode.WorkspaceAccessDenied, 'directory not accessible');
    }
    const entries: WorkspaceEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.name === '.git' || isSensitiveName(dirent.name)) continue;
      const isDir = dirent.isDirectory();
      const entry: WorkspaceEntry = { name: dirent.name, type: isDir ? 'dir' : 'file' };
      if (!isDir) {
        try {
          // One stat call yields both size and last-modified (the file browser
          // shows them on the entry's detail line).
          const info = await stat(resolve(resolvedRoot, dirent.name));
          entry.size = info.size;
          entry.mtime = Math.round(info.mtimeMs);
        } catch {
          // ignore unreadable entries' size/mtime
        }
      }
      entries.push(entry);
    }
    entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
    );
    return { cwd: '.', entries };
  }

  async applyPatch(root: string, changes: PatchChange[]): Promise<ApplyResult> {
    let applied = 0;
    for (const change of changes) {
      const abs = resolveWithinRoot(root, change.path);
      if (change.op === 'delete') {
        await rm(abs, { force: true });
        applied += 1;
        continue;
      }
      // add | modify
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, change.content ?? '', 'utf-8');
      applied += 1;
    }
    return { success: true, applied };
  }

  async #assertReadableFile(abs: string, maxBytes: number): Promise<void> {
    let info;
    try {
      info = await stat(abs);
    } catch {
      throw new RpcError(JsonRpcErrorCode.ResourceNotFound, 'file not found');
    }
    if (!info.isFile()) {
      throw RpcError.invalidParams('path is not a file');
    }
    if (info.size > maxBytes) {
      throw new RpcError(JsonRpcErrorCode.BridgeError, 'file is too large to read');
    }
  }
}

function toRelative(root: string, abs: string): string {
  return relative(resolve(root), abs).split('\\').join('/');
}

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}
