/**
 * Plug-and-play directory browsing: lets the phone navigate sub-directories under
 * a configured base root (e.g. the user's `Documents`), mark which ones are git
 * repos, and pick ANY directory as a thread's cwd — without per-project
 * pre-configuration and without ever escaping above the root.
 *
 * The confinement here applies to the phone-facing browse/workspace API (it
 * reuses {@link resolveWithinRoot}, which rejects `..`/absolute escapes). Note it
 * does NOT sandbox the agent process itself: once a directory is chosen as a
 * thread cwd, the agent CLI runs there and can act on that subtree (writes are
 * bounded by each agent's sandbox posture). See bridge/FOR-HUMAN.md.
 *
 * Source: architecture/02a-system-architecture.md §5.8.5 (project resolution),
 * extended for plug-and-play browsing.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { JsonRpcErrorCode, RpcError, type BrowseResult, type BrowseRoot } from '@uxnan/shared';
import { isSensitiveName, resolveWithinRoot } from './path-guard.js';

/** Stable id derived from the absolute path, so it survives restarts. */
export function browseRootIdFor(cwd: string): string {
  return `root_${createHash('sha1').update(resolve(cwd)).digest('hex').slice(0, 12)}`;
}

export class BrowseService {
  readonly #roots: string[];

  constructor(roots: string[], fallback: string = homedir()) {
    const resolved = [...new Set(roots.map((r) => resolve(r)).filter((r) => r.length > 0))];
    this.#roots = resolved.length > 0 ? resolved : [resolve(fallback)];
  }

  listRoots(): BrowseRoot[] {
    return this.#roots.map((cwd) => ({
      id: browseRootIdFor(cwd),
      name: basename(cwd) || cwd,
      cwd,
    }));
  }

  /** Browse `path` (relative to `rootId`, default the first root and its top). */
  async browse(rootId?: string, path?: string): Promise<BrowseResult> {
    const root = this.#resolveRoot(rootId);
    const rel = (path ?? '').replace(/^[/\\]+/, '');
    const abs = resolveWithinRoot(root, rel === '' ? '.' : rel);

    let dirents;
    try {
      dirents = await readdir(abs, { withFileTypes: true });
    } catch {
      throw new RpcError(JsonRpcErrorCode.WorkspaceAccessDenied, 'directory not accessible');
    }

    const dirs = dirents
      .filter((d) => d.isDirectory() && d.name !== '.git' && !isSensitiveName(d.name))
      .map((d) => {
        const childAbs = join(abs, d.name);
        return { name: d.name, path: toRel(root, childAbs), isGitRepo: isGitRepo(childAbs) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const currentPath = toRel(root, abs);
    return {
      roots: this.listRoots(),
      rootId: browseRootIdFor(root),
      path: currentPath,
      parent: parentOf(currentPath),
      cwd: abs,
      isGitRepo: isGitRepo(abs),
      dirs,
    };
  }

  #resolveRoot(rootId?: string): string {
    if (!rootId) return this.#roots[0]!;
    const match = this.#roots.find((r) => browseRootIdFor(r) === rootId);
    if (!match) {
      throw new RpcError(JsonRpcErrorCode.ResourceNotFound, `unknown browse root: ${rootId}`);
    }
    return match;
  }
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/** Path of `abs` relative to `root`, POSIX separators (`''` when `abs` IS root). */
function toRel(root: string, abs: string): string {
  return relative(resolve(root), abs).split(sep).join('/');
}

/** Parent of a root-relative POSIX path, or null at the root. */
function parentOf(relPosix: string): string | null {
  if (relPosix === '') return null;
  const idx = relPosix.lastIndexOf('/');
  return idx === -1 ? '' : relPosix.slice(0, idx);
}
