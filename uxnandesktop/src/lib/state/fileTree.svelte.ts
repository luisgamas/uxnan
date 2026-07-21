// File-tree state for the right-panel "Files" tab (Svelte 5 runes).
//
// Kept in a singleton store (not in the component) so the lazy-loaded tree and
// its expanded folders survive the tab being unmounted when the user flips to
// the "Changes" tab and back. Reset whenever the active worktree changes. All FS
// access goes through `$lib/api`.

import { listen } from "@tauri-apps/api/event";
import {
  fsCreateDir,
  fsCreateFile,
  fsDelete,
  fsDuplicate,
  fsListDir,
  fsRename,
  fsSearchFiles,
} from "$lib/api";
import { terminals } from "$lib/state/terminals.svelte";
import type { FsChangedEvent, FsEntry } from "$lib/types";

/** Safety cap for "expand all" so it never tries to load an unbounded tree. */
const EXPAND_ALL_CAP = 1500;

/** Max project-wide search results to fetch (a prefix past this → `truncated`). */
const SEARCH_LIMIT = 500;
/** Debounce before firing a project-wide search as the query changes. */
const SEARCH_DEBOUNCE_MS = 180;

/** Parent directory of a forward-slash path (drops the last segment). */
function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

class FileTreeStore {
  /** Active worktree root (forward-slash, no trailing slash), or null. */
  root = $state<string | null>(null);
  /** Lazily-loaded children keyed by directory path. */
  childrenByDir = $state<Record<string, FsEntry[]>>({});
  /** Set of expanded directory paths. */
  expanded = $state<Set<string>>(new Set());
  /** Directories with an in-flight listing (drives the spinner). */
  loadingDir = $state<Set<string>>(new Set());
  error = $state<string | null>(null);
  /** Live filter query for the tree (matches entry names; empty = no filter). */
  query = $state("");
  /** Folder the search is restricted to ("Find in Folder"); null = whole tree. */
  searchScope = $state<string | null>(null);
  /** Whether dotfiles (hidden files) are shown in the tree + included in search. */
  showHidden = $state(true);
  /** Project-wide search results (files) for the current query; empty when idle. */
  searchResults = $state<FsEntry[]>([]);
  /** A search is in flight (drives the header spinner / "searching" state). */
  searchLoading = $state(false);
  /** The last search hit the result cap (its list is a prefix). */
  searchTruncated = $state(false);
  /** The row the user last clicked (file or folder). Drives the selection
   *  highlight and resolves the target directory for a toolbar-triggered create
   *  (folder → inside it; file → its parent; nothing selected → the root). */
  selectedEntry = $state<FsEntry | null>(null);
  /** An in-progress inline "New File" / "New Folder" (VSCode-style): a draft input
   *  row renders as the first child of `dir` until the user commits or cancels. */
  draft = $state<{ dir: string; kind: "file" | "folder" } | null>(null);
  private listening = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic id so a slow search can't overwrite a newer one's results. */
  private searchSeq = 0;

  /** Subscribe to the backend's `fs:changed` events (once) so files created,
   *  deleted or edited on disk reload the affected directories automatically.
   *  Events for a root other than the one we're showing are ignored. */
  async startListening(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    try {
      await listen<FsChangedEvent>("fs:changed", (e) => {
        if (e.payload.root === this.root) this.applyFsChange(e.payload.paths);
      });
    } catch {
      // No Tauri event bus (e.g. the plain web preview) — manual refresh only.
      this.listening = false;
    }
  }

  /** Reload every already-loaded directory whose contents may have changed. The
   *  backend reports each changed path together with its parent dir, so a new or
   *  deleted entry surfaces by reloading the parent (which we have loaded iff
   *  it's expanded/visible). Collapsed/unloaded dirs are skipped — they reload
   *  lazily on next expand. */
  private applyFsChange(paths: string[]): void {
    const affected = new Set(paths);
    for (const dir of Object.keys(this.childrenByDir)) {
      if (affected.has(dir)) void this.loadDir(dir, true);
    }
  }

  /** Point the tree at a worktree root, resetting + loading it. No-op when the
   *  root is unchanged, so remounting the tab keeps the expanded state. The
   *  backend filesystem watcher is aimed centrally (in `+page.svelte`) so it
   *  follows the active worktree regardless of which panel/tab is open. */
  setRoot(root: string | null): void {
    void this.startListening();
    if (root === this.root) return;
    this.root = root;
    this.childrenByDir = {};
    this.expanded = new Set();
    this.error = null;
    this.query = "";
    this.searchScope = null;
    this.selectedEntry = null;
    this.draft = null;
    this.clearSearch();
    if (root) void this.loadDir(root);
  }

  /** Collapse every folder. */
  collapseAll(): void {
    this.expanded = new Set();
  }

  /** Expand the whole tree, loading folders level by level as needed. Capped at
   *  [`EXPAND_ALL_CAP`] directories so it can't freeze on a giant tree
   *  (`node_modules`, …); past the cap it stops, leaving the rest collapsed. */
  async expandAll(): Promise<void> {
    if (!this.root) return;
    const next = new Set(this.expanded);
    const queue: string[] = [this.root];
    let visited = 0;
    while (queue.length > 0 && visited < EXPAND_ALL_CAP) {
      const dir = queue.shift()!;
      visited++;
      await this.loadDir(dir);
      for (const e of this.childrenByDir[dir] ?? []) {
        if (e.isDir) {
          next.add(e.path);
          queue.push(e.path);
        }
      }
    }
    this.expanded = next;
  }

  async loadDir(dir: string, force = false): Promise<void> {
    if (this.childrenByDir[dir] && !force) return;
    this.loadingDir = new Set(this.loadingDir).add(dir);
    try {
      const entries = await fsListDir(dir);
      this.childrenByDir = { ...this.childrenByDir, [dir]: entries };
      this.error = null;
    } catch (e) {
      this.error = msg(e);
    } finally {
      const s = new Set(this.loadingDir);
      s.delete(dir);
      this.loadingDir = s;
    }
  }

  /** Expand/collapse a directory (loading its children on first expand). */
  toggle(entry: FsEntry): void {
    const next = new Set(this.expanded);
    if (next.has(entry.path)) {
      next.delete(entry.path);
    } else {
      next.add(entry.path);
      void this.loadDir(entry.path);
    }
    this.expanded = next;
  }

  /** Reload every already-loaded directory (keeps the expansion state); also
   *  re-runs an active project-wide search so its results reflect disk changes. */
  refresh(): void {
    for (const dir of Object.keys(this.childrenByDir)) void this.loadDir(dir, true);
    if (this.query.trim()) void this.runSearch();
  }

  // --- Project-wide filename search ----------------------------------------
  // Unlike the lazy tree (which only knows `childrenByDir`), this hits the backend
  // `fs_search_files` walker so files in never-expanded folders are found. Driven
  // by the panel: it calls `scheduleSearch()` whenever the query / scope / hidden
  // toggle changes.

  /** Debounced (re)search from the current query/scope/hidden state. An empty
   *  query clears results immediately (no backend call). */
  scheduleSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!this.query.trim() || !this.root) {
      this.clearSearch();
      return;
    }
    this.searchLoading = true;
    this.searchTimer = setTimeout(() => void this.runSearch(), SEARCH_DEBOUNCE_MS);
  }

  /** Run the search now against `searchScope ?? root`. A monotonic sequence id
   *  drops any response that a newer query has already superseded. */
  private async runSearch(): Promise<void> {
    const root = this.searchScope ?? this.root;
    const q = this.query.trim();
    if (!root || !q) {
      this.clearSearch();
      return;
    }
    const seq = ++this.searchSeq;
    this.searchLoading = true;
    try {
      const res = await fsSearchFiles(root, q, this.showHidden, SEARCH_LIMIT);
      if (seq !== this.searchSeq) return;
      this.searchResults = res.entries;
      this.searchTruncated = res.truncated;
      this.error = null;
    } catch (e) {
      if (seq !== this.searchSeq) return;
      this.error = msg(e);
      this.searchResults = [];
      this.searchTruncated = false;
    } finally {
      if (seq === this.searchSeq) this.searchLoading = false;
    }
  }

  /** Cancel any pending/in-flight search and drop its results. */
  private clearSearch(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.searchSeq++; // invalidate any in-flight response
    this.searchResults = [];
    this.searchTruncated = false;
    this.searchLoading = false;
  }

  // --- Context-menu file operations ----------------------------------------
  // Each mutates the disk via `$lib/api`, then reloads the affected folder so the
  // tree reflects the change immediately (the fs watcher would also catch it, but
  // only for currently-expanded folders and after a debounce). Failures throw so
  // the calling dialog can surface the backend message inline.

  /** Create a new file/folder at `rel` inside `dir` (`rel` may be a VSCode-style
   *  intercalated path — `sub/leaf` — which also creates the intermediate folders),
   *  then reveal the new entry: expand the whole `dir → parent` chain, reload it,
   *  and select the leaf. Returns the new absolute path; throws so the caller can
   *  surface the backend error inline. */
  async createEntry(dir: string, rel: string, kind: "file" | "folder"): Promise<string> {
    const path = kind === "folder" ? await fsCreateDir(dir, rel) : await fsCreateFile(dir, rel);
    await this.revealNewEntry(dir, path);
    this.selectedEntry = {
      name: path.split("/").pop() ?? path,
      path,
      isDir: kind === "folder",
      ignored: false,
    };
    return path;
  }

  /** Expand + force-reload every folder from `dir` (exclusive) down to the new
   *  entry's parent (inclusive) — the intermediate folders an intercalated path
   *  just created — so the leaf becomes visible in the tree. */
  private async revealNewEntry(dir: string, leaf: string): Promise<void> {
    const parent = parentOf(leaf);
    const chain: string[] = [];
    let cur = parent;
    while (cur.length > dir.length && cur !== dir) {
      chain.unshift(cur);
      const up = parentOf(cur);
      if (up === cur) break;
      cur = up;
    }
    const exp = new Set(this.expanded).add(dir);
    for (const d of chain) exp.add(d);
    this.expanded = exp;
    await this.loadDir(dir, true);
    for (const d of chain) await this.loadDir(d, true);
  }

  /** Start an inline "New File" / "New Folder" draft inside `dir`: expand `dir` and
   *  every ancestor up to the root (their listings stay cached when collapsed) and
   *  load `dir`, so the draft input row is always visible as `dir`'s first child. */
  beginDraft(dir: string, kind: "file" | "folder"): void {
    if (this.root && dir !== this.root) {
      const exp = new Set(this.expanded);
      let cur = dir;
      while (cur.length >= this.root.length) {
        exp.add(cur);
        if (cur === this.root) break;
        const up = parentOf(cur);
        if (up === cur) break;
        cur = up;
      }
      this.expanded = exp;
      void this.loadDir(dir);
    }
    this.draft = { dir, kind };
  }

  /** Rename an entry (bare name, same folder) and re-point any open tabs. Reloads
   *  the parent so the new name shows. Returns the new path; throws on failure. */
  async renameEntry(entry: FsEntry, newName: string): Promise<string> {
    const newPath = await fsRename(entry.path, newName);
    await terminals.repathTabs(entry.path, newPath);
    // A renamed folder's children now live under a different path — drop the stale
    // expansion + cached listing so the reload rebuilds them under the new path.
    if (entry.isDir) this.forgetSubtree(entry.path);
    await this.loadDir(parentOf(entry.path), true);
    return newPath;
  }

  /** Move an entry to the OS trash, closing any open tabs under it and reloading
   *  the parent folder. Throws on failure so the confirm dialog shows the error. */
  async deleteEntry(entry: FsEntry): Promise<void> {
    await fsDelete(entry.path);
    terminals.closeTabsUnder(entry.path);
    if (entry.isDir) this.forgetSubtree(entry.path);
    await this.loadDir(parentOf(entry.path), true);
  }

  /** Duplicate a file next to itself ("… copy"), reloading its folder. Returns the
   *  new path. */
  async duplicateEntry(entry: FsEntry): Promise<string> {
    const newPath = await fsDuplicate(entry.path);
    await this.loadDir(parentOf(entry.path), true);
    return newPath;
  }

  /** Collapse a folder together with all of its descendants ("Collapse Folder"),
   *  keeping their cached listings so re-expanding is instant. */
  collapseSubtree(folderPath: string): void {
    const prefix = folderPath + "/";
    const next = new Set<string>();
    for (const p of this.expanded) {
      if (p !== folderPath && !p.startsWith(prefix)) next.add(p);
    }
    this.expanded = next;
  }

  /** Drop a folder and its descendants from the expanded set + the loaded-children
   *  cache — their paths are gone/changed after a rename or delete. */
  private forgetSubtree(folderPath: string): void {
    const prefix = folderPath + "/";
    const exp = new Set<string>();
    for (const p of this.expanded) {
      if (p !== folderPath && !p.startsWith(prefix)) exp.add(p);
    }
    this.expanded = exp;
    const children: Record<string, FsEntry[]> = {};
    for (const [dir, entries] of Object.entries(this.childrenByDir)) {
      if (dir !== folderPath && !dir.startsWith(prefix)) children[dir] = entries;
    }
    this.childrenByDir = children;
  }
}

/** Singleton file-tree store shared by the Files tab. */
export const fileTree = new FileTreeStore();
