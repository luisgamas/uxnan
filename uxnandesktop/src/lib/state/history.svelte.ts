// Commit-history state for the right panel's "History" tab (Svelte 5 runes).
//
// Holds the paginated commit log for the **active worktree**, a client-side
// filter, and the list/graph view toggle. The log is fetched on demand (when the
// tab first shows a worktree, on "load more", and on a manual refresh); it is
// marked stale by the git store after a commit/push/pull so it re-fetches the
// next time the tab is shown.

import { gitLog } from "$lib/api";
import { toastError } from "$lib/toast";
import type { CommitInfo } from "$lib/types";

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

/** How many commits to fetch per page (initial load + each "load more"). */
const PAGE = 100;

class HistoryStore {
  /** Active worktree path the tab reflects (null = none selected). */
  path = $state<string | null>(null);
  commits = $state<CommitInfo[]>([]);
  loading = $state(false);
  loadingMore = $state(false);
  /** Error from the last load (e.g. the path is not a git repo). */
  error = $state<string | null>(null);
  /** No more commits to page in (the last page was short). */
  reachedEnd = $state(false);
  /** Client-side filter over subject / short hash / author. */
  query = $state("");
  /** Whether to draw the branch graph gutter (off → plain list). */
  showGraph = $state(true);

  /** The path whose log is currently loaded (so `ensure` is a no-op when the tab
   *  re-mounts on the same worktree). `null` means "nothing loaded yet". */
  private loadedPath: string | null = null;

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
  ensure(path: string | null): void {
    if (path === this.loadedPath) return;
    void this.load(path);
  }

  /** (Re)load the first page of the log for `path` (or clear it). */
  async load(path: string | null): Promise<void> {
    this.path = path;
    this.loadedPath = path;
    this.error = null;
    this.commits = [];
    this.reachedEnd = false;
    if (!path) return;
    this.loading = true;
    try {
      const page = await gitLog(path, PAGE, 0);
      if (this.path !== path) return; // a newer load superseded this one
      this.commits = page;
      this.reachedEnd = page.length < PAGE;
    } catch (e) {
      this.error = msg(e);
    } finally {
      this.loading = false;
    }
  }

  /** Append the next page of older commits (no-op at the end / while loading). */
  async loadMore(): Promise<void> {
    const path = this.path;
    if (!path || this.loadingMore || this.loading || this.reachedEnd) return;
    this.loadingMore = true;
    try {
      const page = await gitLog(path, PAGE, this.commits.length);
      if (this.path !== path) return;
      this.commits = [...this.commits, ...page];
      if (page.length < PAGE) this.reachedEnd = true;
    } catch (e) {
      toastError(e);
    } finally {
      this.loadingMore = false;
    }
  }

  /** Force a fresh reload of the current worktree's log. */
  refresh(): Promise<void> {
    return this.load(this.path);
  }

  /** Mark the loaded log stale so the next `ensure` re-fetches it. Called by the
   *  git store after a commit/amend/push/pull changes history. */
  markStale(): void {
    this.loadedPath = null;
  }
}

/** Singleton commit-history store shared by the right panel's History tab. */
export const history = new HistoryStore();
