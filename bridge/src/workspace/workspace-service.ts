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
  WorkspaceMatch,
  WorkspaceSearchResult,
} from '@uxnan/shared';
import { isSensitiveName, resolveWithinRoot } from './path-guard.js';
import { runGit } from '../git/git-runner.js';

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
    // Flag entries git ignores (muted/italic in the file browser). Best-effort:
    // a single `git check-ignore` over this directory's names; a non-repo (or any
    // git error) just leaves every entry un-flagged.
    const ignored = await this.#ignoredNames(
      resolvedRoot,
      entries.map((e) => e.name),
    );
    if (ignored.size > 0) {
      for (const entry of entries) {
        if (ignored.has(entry.name)) entry.ignored = true;
      }
    }
    entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
    );
    return { cwd: '.', entries };
  }

  /**
   * Repo-wide fuzzy file search for the `@`-mention picker (and, later, a file
   * browser search). Honors `.gitignore` and skips `.git` + sensitive files.
   *
   * Candidates are every non-ignored file (tracked + untracked) plus their
   * ancestor directories, so both files and folders are matchable. In a git
   * repo this is a single `git ls-files` (respecting `.gitignore`); outside a
   * repo it falls back to a bounded recursive walk. Matches are ranked
   * basename-substring > path-substring > subsequence, shorter paths first.
   */
  async searchFiles(root: string, query: string, limit?: number): Promise<WorkspaceSearchResult> {
    const resolvedRoot = resolve(root);
    const cap = Math.min(Math.max(limit ?? 40, 1), 100);
    const q = query.trim();

    let files: string[];
    try {
      files = await this.#gitFiles(resolvedRoot);
    } catch {
      files = await this.#walkFiles(resolvedRoot);
    }

    // Every file's ancestor directories are matchable too (so `@lib` finds the
    // folder, not just files under it).
    const dirs = new Set<string>();
    for (const file of files) {
      let slash = file.lastIndexOf('/');
      while (slash > 0) {
        dirs.add(file.slice(0, slash));
        slash = file.lastIndexOf('/', slash - 1);
      }
    }
    const candidates: WorkspaceMatch[] = [
      ...files.map((path): WorkspaceMatch => ({ path, type: 'file' })),
      ...[...dirs].map((path): WorkspaceMatch => ({ path, type: 'dir' })),
    ].filter((c) => !c.path.split('/').some((seg: string) => isSensitiveName(seg)));

    const scored: { match: WorkspaceMatch; score: number }[] = [];
    for (const match of candidates) {
      const score = fuzzyScore(match.path, q);
      if (score !== null) scored.push({ match, score });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.match.path.length - b.match.path.length ||
        a.match.path.localeCompare(b.match.path),
    );
    return {
      cwd: '.',
      matches: scored.slice(0, cap).map((s) => s.match),
      truncated: scored.length > cap,
    };
  }

  /**
   * Non-ignored files (tracked + untracked, honoring `.gitignore`) as
   * workspace-relative POSIX paths, via a single `git ls-files`. Rejects when
   * [dir] isn't a git repo (the caller falls back to a manual walk).
   */
  async #gitFiles(dir: string): Promise<string[]> {
    const { stdout } = await runGit(dir, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
    return stdout.split('\0').filter((p) => p.length > 0 && !p.startsWith('.git/'));
  }

  /**
   * Bounded recursive file walk for non-git workspaces: skips `.git` and
   * sensitive names, caps depth and total files so a huge tree can't hang the
   * search. Returns workspace-relative POSIX paths.
   */
  async #walkFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const maxFiles = 20_000;
    const maxDepth = 12;
    const walk = async (absDir: string, rel: string, depth: number): Promise<void> => {
      if (out.length >= maxFiles || depth > maxDepth) return;
      let dirents;
      try {
        dirents = await readdir(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (out.length >= maxFiles) return;
        if (dirent.name === '.git' || isSensitiveName(dirent.name)) continue;
        const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          await walk(resolve(absDir, dirent.name), childRel, depth + 1);
        } else if (dirent.isFile()) {
          out.push(childRel);
        }
      }
    };
    await walk(root, '', 0);
    return out;
  }

  /**
   * The subset of [names] (basenames in [dir]) that git ignores, via a single
   * `git check-ignore -z`. Tracked files matching an ignore rule are *not*
   * reported (git knows they're tracked), so force-added files stay un-dimmed.
   * Returns an empty set when [dir] isn't a git repo or git errors — the file
   * browser must keep working outside a repository.
   */
  async #ignoredNames(dir: string, names: string[]): Promise<Set<string>> {
    if (names.length === 0) return new Set();
    try {
      // `--stdin -z`: names in on stdin, ignored ones out, both NUL-delimited so
      // names with spaces/newlines round-trip safely and `-` is never a flag.
      const { stdout } = await runGit(dir, ['check-ignore', '-z', '--stdin'], {
        input: names.join('\0'),
      });
      return new Set(stdout.split('\0').filter((n) => n.length > 0));
    } catch {
      // Exit 1 (nothing ignored) and exit 128 (not a repo) both reject here;
      // either way there's nothing to flag.
      return new Set();
    }
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

/**
 * Scores [path] against a fuzzy [query] (higher = better), or null when it
 * doesn't match at all. A substring hit in the basename ranks above one in the
 * full path, which ranks above an in-order subsequence match. An empty query
 * matches everything (score 0) so callers can show a default top slice.
 */
function fuzzyScore(path: string, query: string): number | null {
  if (query.length === 0) return 0;
  const lowerPath = path.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const base = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);

  const baseIdx = base.indexOf(lowerQuery);
  if (baseIdx !== -1) return 1000 - baseIdx;
  const pathIdx = lowerPath.indexOf(lowerQuery);
  if (pathIdx !== -1) return 500 - pathIdx;

  // In-order subsequence (e.g. "lmd" matches "lib/main.dart").
  let qi = 0;
  for (let i = 0; i < lowerPath.length && qi < lowerQuery.length; i++) {
    if (lowerPath[i] === lowerQuery[qi]) qi++;
  }
  return qi === lowerQuery.length ? 100 : null;
}
