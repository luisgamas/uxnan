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
