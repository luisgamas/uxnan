// What an `@` mention offers in the chat composer, asked of the bridge — the
// owner of the conversation's folder, which may not even be on this machine —
// exactly as the phone asks it: a folder (a bare `@`, or `@dir/`) is listed
// with `workspace/list`, anything with a name is searched across the project
// with `workspace/searchFiles`. A picked folder drills in; a picked file is
// written into the message as `@path`.

import type { WorkspaceListing, WorkspaceSearchResult } from '$shared/models/workspace';

/** One thing the panel offers: a path relative to the project, and whether it is a folder. */
export interface MentionEntry {
  path: string;
  isDir: boolean;
}

/** How the bridge is asked (the desktop's `bridge.call`; tests pass a fake). */
export type BridgeCall = <T>(method: string, params: unknown) => Promise<T>;

/** How many matches a search asks for (the phone asks the same). */
export const MENTION_LIMIT = 40;

/** [root] joined with a project-relative folder that ends in `/` (or is empty). */
function folderOf(root: string, dir: string): string {
  if (dir === '') return root;
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  return `${base}${sep}${dir.replace(/\/+$/, '').split('/').join(sep)}`;
}

/** The entries for the mention [query] (what follows `@`) in the project at [root]. */
export async function mentionEntries(
  call: BridgeCall,
  root: string,
  query: string,
): Promise<MentionEntry[]> {
  const slash = query.lastIndexOf('/');
  const name = query.slice(slash + 1);
  if (name === '') {
    const dir = query.slice(0, slash + 1);
    const listing = await call<WorkspaceListing>('workspace/list', { cwd: folderOf(root, dir) });
    return listing.entries
      .map((e) => ({ path: `${dir}${e.name}`, isDir: e.type === 'dir' }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path));
  }
  const found = await call<WorkspaceSearchResult>('workspace/searchFiles', {
    cwd: root,
    query,
    limit: MENTION_LIMIT,
  });
  return found.matches.map((m) => ({ path: m.path, isDir: m.type === 'dir' }));
}

/**
 * The mention for [path] — a file dropped on the composer — when it lies inside
 * the project at [root]: its project-relative path, `/`-separated, exactly as
 * picking it from `@` writes it. `null` for anything outside (or the folder
 * itself). The desktop's bridge runs on this machine, so a local path under
 * the root names the same file the bridge will read.
 */
export function mentionFor(root: string, path: string): string | null {
  const windows = /^[A-Za-z]:[\\/]/.test(root);
  const norm = (p: string) => {
    const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return windows ? slashed.toLowerCase() : slashed;
  };
  const base = norm(root);
  const full = norm(path);
  if (base === '' || !full.startsWith(`${base}/`)) return null;
  const relative = path.replace(/\\/g, '/').replace(/\/+$/, '').slice(base.length + 1);
  return relative === '' ? null : `@${relative}`;
}
