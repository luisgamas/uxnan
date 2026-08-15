// Commit-history state for the right panel's "History" tab (Svelte 5 runes).
//
// Holds the paginated commit log for the **active worktree**, a client-side
// filter, and the list/graph view toggle. The log is fetched on demand (when the
// tab first shows a worktree, on "load more", and on a manual refresh); it is
// refreshed by the git store after Uxnan or an external client moves HEAD.
//
// The worktree can be on another machine, so every read goes through
// `$lib/gitRouter` with the target beside the path — one absolute path names a
// different folder on every machine. On a host there is no watcher to notice an
// external commit (see the note in `git.svelte.ts`), so History there is exactly
// as fresh as the last thing that asked for it.

import { logOn, showOn } from "$lib/gitRouter";
import { LOCAL_TARGET, type TargetId } from "$lib/target";
import { toastError } from "$lib/toast";
import { splitCommitDiff, type CommitFile } from "$lib/diffParse";
import type { CommitInfo } from "$lib/types";

/** Per-commit changed-file cache entry (lazily loaded when a commit expands). */
export interface CommitFilesState {
  status: "loading" | "ready" | "error";
  files: CommitFile[];
}

/** Whether a failure is "that host is not connected yet" — a state, not a
 *  fault. Matched on the backend's own code, like every other panel here. */
function isNotConnected(e: unknown): boolean {
  return (
    !!e && typeof e === "object" && "code" in e && (e as { code: unknown }).code === "NOT_CONNECTED"
  );
}

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

/** How many commits to fetch per page (initial load + each "load more"). */
const PAGE = 100;

class HistoryStore {
  /** Active worktree path the tab reflects (null = none selected). */
  path = $state<string | null>(null);
  /** The machine that worktree is on. */
  target = $state<TargetId>(LOCAL_TARGET);
  commits = $state<CommitInfo[]>([]);
  loading = $state(false);
  loadingMore = $state(false);
  /** Error from the last load (e.g. the path is not a git repo). */
  error = $state<string | null>(null);
  /** The worktree is on a host that has not connected yet — a state, not a
   *  fault, and one the panel says plainly (same as the file tree and Changes).
   *  The log fills in when the host comes up, because the panel's effect reads
   *  the session registry and re-runs. */
  awaitingHost = $state(false);
  /** No more commits to page in (the last page was short). */
  reachedEnd = $state(false);
  /** Client-side filter over subject / short hash / author. */
  query = $state("");
  /** Whether to draw the branch graph gutter (off → plain list). */
  showGraph = $state(true);

  /** Which commits are expanded (showing their changed-file list) by hash. */
  expanded = $state<Record<string, boolean>>({});
  /** Lazily-loaded changed-file lists per commit hash (parsed from `git show`). */
  fileCache = $state<Record<string, CommitFilesState>>({});

  isExpanded(hash: string): boolean {
    return this.expanded[hash] === true;
  }
  filesFor(hash: string): CommitFilesState | undefined {
    return this.fileCache[hash];
  }

  /** Toggle a commit's expanded file list; load (and cache) its files on first
   *  expand. Commit diffs are immutable, so the cache is kept until the worktree
   *  changes. */
  toggleExpand(hash: string): void {
    if (this.expanded[hash]) {
      this.expanded[hash] = false;
      return;
    }
    this.expanded[hash] = true;
    if (!this.fileCache[hash]) void this.loadFiles(hash);
  }

  private async loadFiles(hash: string): Promise<void> {
    const path = this.path;
    if (!path) return;
    this.fileCache[hash] = { status: "loading", files: [] };
    try {
      const full = await showOn(this.target, path, hash);
      if (this.path !== path) return; // worktree switched under us
      this.fileCache[hash] = { status: "ready", files: splitCommitDiff(full) };
    } catch {
      this.fileCache[hash] = { status: "error", files: [] };
    }
  }

  /** The path whose log is currently loaded (so `ensure` is a no-op when the tab
   *  re-mounts on the same worktree). `null` means "nothing loaded yet". */
  private loadedPath: string | null = null;
  /** Guards every async page load, including the A → B → A switch case where a
   *  path-only check cannot distinguish the first A response from the latest. */
  private loadSeq = 0;

  /** Commits matching the current filter (everything when the filter is empty). */
  filtered = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.commits;
    return this.commits.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.shortHash.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q),
    );
  });

  /** Load the log for `path` only if it isn't already loaded (cheap on tab
   *  re-mount). Pass a new worktree path to switch; use `refresh()` to force. */
  ensure(path: string | null, target: TargetId = LOCAL_TARGET): void {
    if (path === this.loadedPath && target === this.target) return;
    void this.load(path, target);
  }

  /** (Re)load the first page of the log for `path` (or clear it). */
  async load(path: string | null, target: TargetId = LOCAL_TARGET): Promise<void> {
    const seq = ++this.loadSeq;
    this.path = path;
    this.target = target;
    this.loadedPath = path;
    this.error = null;
    this.awaitingHost = false;
    this.commits = [];
    this.reachedEnd = false;
    this.loadingMore = false;
    // A different worktree's expansions/file caches don't apply here.
    this.expanded = {};
    this.fileCache = {};
    if (!path) {
      this.loading = false;
      return;
    }
    this.loading = true;
    try {
      const page = await logOn(target, path, PAGE, 0);
      if (seq !== this.loadSeq || this.path !== path) return;
      this.commits = page;
      this.reachedEnd = page.length < PAGE;
    } catch (e) {
      if (seq !== this.loadSeq || this.path !== path) return;
      this.awaitingHost = isNotConnected(e);
      this.error = this.awaitingHost ? null : msg(e);
    } finally {
      if (seq === this.loadSeq) this.loading = false;
    }
  }

  /** Append the next page of older commits (no-op at the end / while loading). */
  async loadMore(): Promise<void> {
    const path = this.path;
    if (!path || this.loadingMore || this.loading || this.reachedEnd) return;
    const seq = this.loadSeq;
    this.loadingMore = true;
    try {
      const page = await logOn(this.target, path, PAGE, this.commits.length);
      if (seq !== this.loadSeq || this.path !== path) return;
      this.commits = [...this.commits, ...page];
      if (page.length < PAGE) this.reachedEnd = true;
    } catch (e) {
      if (seq === this.loadSeq && this.path === path) toastError(e);
    } finally {
      if (seq === this.loadSeq) this.loadingMore = false;
    }
  }

  /** Force a fresh reload of the current worktree's log. */
  refresh(): Promise<void> {
    return this.load(this.path, this.target);
  }

  /** HEAD (or one of its decorations after push/pull) changed while this path's
   *  log was already cached. Refresh it immediately, even if the tab is not the
   *  visible one; otherwise invalidate it for the next `ensure`. */
  refreshIfLoaded(path: string): void {
    if (this.path === path && this.loadedPath === path) {
      void this.load(path, this.target);
    } else if (this.loadedPath === path) {
      this.loadedPath = null;
    }
  }

  /** Compare a first watcher snapshot with the log itself. This closes the tiny
   *  startup window where History loaded before the watcher established its own
   *  per-path HEAD baseline. */
  loadedHeadDiffers(path: string, head: string | null): boolean {
    return (
      !this.loading &&
      this.path === path &&
      this.loadedPath === path &&
      (this.commits[0]?.hash ?? null) !== head
    );
  }
}

/** Singleton commit-history store shared by the right panel's History tab. */
export const history = new HistoryStore();
