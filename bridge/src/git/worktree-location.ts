/**
 * Where a new worktree lands on disk — the bridge's half of the layout the
 * desktop resolves in `uxnandesktop/src-tauri/src/worktreeloc.rs`.
 *
 * **This file is a mirror, and the mirror is the point.** The two apps place
 * worktrees for the SAME repository, so a repo the user opens on the phone and
 * on the desktop must group its checkouts in one place. Both sides are driven
 * by the same table of cases (`worktree-location.test.ts` here,
 * `worktreeloc.rs`'s tests there); a change to one is a change to both.
 *
 * Layouts (config `worktrees.location`):
 * - `managed` (default): `<home>/uxnan/worktrees/<repo>/<branch>` — grouped by
 *   project under a folder uxnan owns, beside the `<home>/uxnan/<repo>` the
 *   desktop's clone flow writes to;
 * - `sibling`: `<parent>/<repo>--<branch>`, matching the desktop's legacy mode;
 * - `custom`: the managed layout under a root the user names.
 *
 * Never inside the repository's own work tree: a checkout under `<repo>/…` is
 * untracked content git wants ignored, `git clean -xdf` deletes it, and every
 * tool that walks the tree would walk one copy of the project per worktree.
 */
import { homedir } from 'node:os';
import { dirname, basename, join } from 'node:path';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';

/** Which layout new worktrees use. */
export type WorktreeLocationMode = 'managed' | 'sibling' | 'custom';

export interface WorktreeLocationConfig {
  location: WorktreeLocationMode;
  /** Root for `custom`; ignored by the other modes. */
  root?: string;
}

/**
 * Longest branch-derived folder name produced. Long enough to stay readable,
 * short enough that the checkout's own deep paths (`node_modules`, `target`)
 * still fit inside Windows' 260-character limit.
 */
const MAX_BRANCH_FOLDER = 60;

/**
 * Names Windows reserves device-wide: unusable as a folder name, with or
 * without an extension (`CON`, `con.txt`). A branch that produces one is
 * prefixed with `_`.
 */
const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** Name of the marker file written beside a repository's grouped worktrees. */
export const MARKER_FILE = '.uxnan-repo';

/**
 * Canonical form for every path returned here: forward slashes, no trailing
 * slash. Matches what `git worktree list` reports (git normalizes to `/` even
 * on Windows), which is the spelling clients key their per-worktree state off.
 */
export function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const trimmed = slashed.replace(/\/+$/, '');
  // A root like `C:/` or `/` keeps its slash.
  return trimmed === '' || trimmed.endsWith(':') ? slashed : trimmed;
}

/**
 * Fold a branch name into a folder name valid on every OS the apps run on.
 *
 * Beyond flattening `/`, this drops the characters Windows rejects outright,
 * trims the trailing dots and spaces it silently strips (which would make the
 * folder git created and the folder we asked for two different names), escapes
 * the reserved device names, and caps the length on a word boundary.
 */
export function sanitizeBranch(branch: string): string {
  let out = '';
  for (const ch of branch) {
    if (ch === '/' || ch === '\\') {
      out += '-';
      continue;
    }
    if ('<>:"|?*'.includes(ch)) continue;
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }

  // Cap on a word boundary: cutting mid-word reads like a typo in a file tree.
  if ([...out].length > MAX_BRANCH_FOLDER) {
    const capped = [...out].slice(0, MAX_BRANCH_FOLDER).join('');
    const at = capped.lastIndexOf('-');
    out = at > 0 ? capped.slice(0, at) : capped;
  }

  // A leading `-` would read as an option to git; leading dots hide the folder.
  out = out.replace(/^[\s.-]+/, '').replace(/[\s.-]+$/, '');
  if (out === '') return 'branch';

  const stem = (out.split('.')[0] ?? out).toUpperCase();
  return WINDOWS_RESERVED.has(stem) ? `_${out}` : out;
}

/**
 * A short, stable digest of a repository path, used only to tell two projects
 * that share a folder name apart (`api` and `api-4f2a91c8`).
 *
 * FNV-1a, written out rather than taken from a hash library, so it produces the
 * same eight characters here and in the desktop's Rust — it names a folder on
 * the user's disk, so the two must never disagree.
 */
export function repoHash(repoPath: string): string {
  // Lowercased unconditionally so the digest does not depend on the platform.
  const key = normalize(repoPath).toLowerCase();
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(key, 'utf8')) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return (((hash >> 32n) ^ hash) & 0xffffffffn).toString(16).padStart(8, '0');
}

/**
 * The folder name a repository's worktrees are grouped under: the name of its
 * **main** worktree's directory, sanitized the same way a branch is.
 */
export function repoKey(mainWorktreePath: string): string {
  const name = basename(normalize(mainWorktreePath));
  const safe = sanitizeBranch(name);
  return safe === 'branch' && name === '' ? 'repo' : safe;
}

/** The default managed root, `<home>/uxnan/worktrees`. */
export function defaultRoot(home: string = homedir()): string {
  return `${normalize(home)}/uxnan/worktrees`;
}

/** `<root>/<repo-key>/<safe-branch>`. */
export function managedPath(root: string, key: string, branch: string): string {
  return `${normalize(root)}/${key}/${sanitizeBranch(branch)}`;
}

/**
 * The pre-existing desktop layout: a sibling of the repo named
 * `<repo>--<branch>`, with branch separators flattened.
 */
export function siblingPath(repoPath: string, branch: string): string {
  const repo = normalize(repoPath);
  const parent = normalize(dirname(repo));
  return `${parent}/${basename(repo)}--${branch.replace(/[\\/]/g, '-')}`;
}

/** `path`, `path-2`, `path-3`, … — how a taken destination is made free. */
export function nthCandidate(path: string, n: number): string {
  return n <= 1 ? path : `${path}-${n}`;
}

/** Whether `contents` of a group marker names the same repository as `main`. */
export function markerMatches(contents: string, main: string): boolean {
  return normalize(contents.trim()).toLowerCase() === normalize(main).toLowerCase();
}

/** A resolved destination and the repository it belongs to. */
export interface ResolvedWorktree {
  path: string;
  mainWorktree: string;
  /** False for the sibling layout, which must not have folders created for it. */
  managed: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The first of `path`, `path-2`, … that is free. */
async function uniquePath(path: string): Promise<string> {
  for (let n = 1; n <= 99; n += 1) {
    const candidate = nthCandidate(path, n);
    if (!(await exists(candidate))) return candidate;
  }
  return nthCandidate(path, 99);
}

/**
 * The group folder for this repository under `root`, disambiguated when a
 * different project already claimed the name.
 */
async function groupKey(root: string, main: string): Promise<string> {
  const key = repoKey(main);
  try {
    const contents = await readFile(join(root, key, MARKER_FILE), 'utf8');
    if (markerMatches(contents, main)) return key;
    return `${key}-${repoHash(main)}`;
  } catch {
    // No marker (a fresh group, or one from before markers) — the name is ours.
    return key;
  }
}

/**
 * Where a worktree for [branch] off the repository whose MAIN worktree is
 * [mainWorktree] should be created. Read-only.
 *
 * The caller resolves the main worktree (`git worktree list`) — measuring from
 * it is what stops a worktree created from inside another one from nesting
 * under it.
 */
export async function resolveWorktreePath(
  mainWorktree: string,
  branch: string,
  config: WorktreeLocationConfig,
  home: string = homedir(),
): Promise<ResolvedWorktree> {
  const main = normalize(mainWorktree);
  if (config.location === 'sibling') {
    return { path: await uniquePath(siblingPath(main, branch)), mainWorktree: main, managed: false };
  }
  const configured = config.location === 'custom' ? config.root?.trim() : undefined;
  const root = configured ? normalize(configured) : defaultRoot(home);
  const key = await groupKey(root, main);
  return {
    path: await uniquePath(managedPath(root, key, branch)),
    mainWorktree: main,
    managed: true,
  };
}

/**
 * Create the parent folder of a resolved path and claim it for this repository,
 * right before `git worktree add` runs. Best-effort: a marker that cannot be
 * written only costs the next same-named project its suffix, so it must never
 * block creating the worktree.
 */
export async function prepareWorktreePath(resolved: ResolvedWorktree): Promise<void> {
  if (!resolved.managed) return;
  const parent = dirname(resolved.path);
  try {
    await mkdir(parent, { recursive: true });
  } catch {
    return;
  }
  const marker = join(parent, MARKER_FILE);
  if (await exists(marker)) return;
  await writeFile(marker, normalize(resolved.mainWorktree), 'utf8').catch(() => undefined);
}
