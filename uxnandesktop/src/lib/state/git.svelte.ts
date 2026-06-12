// Git review state for the right panel (Svelte 5 runes).
//
// Holds the changed-file list, staging actions, the selected file's diff and the
// commit message for the **active worktree**. The panel reloads on demand (after
// each action, on a manual refresh, and when the active worktree changes); the
// real-time 3 s status polling + Tauri events are a Phase 3 follow-up (FOR-DEV).

import {
  gitCommit,
  gitDiff,
  gitDiscard,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
} from "$lib/api";
import type { FileChange } from "$lib/types";

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

/** A changed file with the staged/unstaged/untracked flags derived from its
 *  XY status codes. A file can be both staged and unstaged (e.g. "MM"). */
export interface FileEntry extends FileChange {
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

function classify(f: FileChange): FileEntry {
  const untracked = f.index === "?" && f.worktree === "?";
  const staged = !untracked && f.index !== " " && f.index !== "";
  const unstaged = untracked || (f.worktree !== " " && f.worktree !== "");
  return { ...f, staged, unstaged, untracked };
}

class GitStore {
  /** Active worktree path the panel reflects (null = no worktree selected). */
  path = $state<string | null>(null);
  files = $state<FileEntry[]>([]);
  loading = $state(false);
  /** A staging/commit action is in flight (disables the action buttons). */
  busy = $state(false);
  error = $state<string | null>(null);
  /** Commit message composer. */
  message = $state("");
  committing = $state(false);

  /** The file whose diff is open in the viewer, or null when closed. */
  selected = $state<{ file: string; staged: boolean } | null>(null);
  diff = $state("");
  diffLoading = $state(false);

  /** Files with a staged change / with a working-tree (or untracked) change. */
  staged = $derived(this.files.filter((f) => f.staged));
  changed = $derived(this.files.filter((f) => f.unstaged));

  /** Point the panel at a worktree (or clear it) and load its status. */
  async load(path: string | null): Promise<void> {
    this.path = path;
    this.error = null;
    this.selected = null;
    if (!path) {
      this.files = [];
      return;
    }
    this.loading = true;
    try {
      this.files = (await gitStatus(path)).map(classify);
    } catch (e) {
      this.error = msg(e);
      this.files = [];
    } finally {
      this.loading = false;
    }
  }

  /** Re-read the current worktree's status (no-op when none is selected). */
  refresh(): Promise<void> {
    return this.load(this.path);
  }

  /** Open the diff viewer for a file in the given area (staged or not). */
  async openDiff(file: string, staged: boolean): Promise<void> {
    if (!this.path) return;
    this.selected = { file, staged };
    this.diff = "";
    this.diffLoading = true;
    try {
      this.diff = await gitDiff(this.path, file, staged);
    } catch (e) {
      this.error = msg(e);
    } finally {
      this.diffLoading = false;
    }
  }
  closeDiff(): void {
    this.selected = null;
    this.diff = "";
  }

  /** Run a staging action then refresh, surfacing any error. */
  private async op(fn: (path: string) => Promise<void>): Promise<void> {
    const path = this.path;
    if (!path) return;
    this.busy = true;
    this.error = null;
    try {
      await fn(path);
      await this.refresh();
    } catch (e) {
      this.error = msg(e);
    } finally {
      this.busy = false;
    }
  }

  stage(file: string): Promise<void> {
    return this.op((p) => gitStage(p, file));
  }
  unstage(file: string): Promise<void> {
    return this.op((p) => gitUnstage(p, file));
  }
  stageAll(): Promise<void> {
    return this.op((p) => gitStageAll(p));
  }
  unstageAll(): Promise<void> {
    return this.op((p) => gitUnstageAll(p));
  }
  discard(file: string, untracked: boolean): Promise<void> {
    return this.op((p) => gitDiscard(p, file, untracked));
  }

  /** Commit the staged changes; clears the message and refreshes on success. */
  async commit(): Promise<void> {
    const path = this.path;
    const message = this.message.trim();
    if (!path || !message) return;
    this.committing = true;
    this.error = null;
    try {
      await gitCommit(path, message);
      this.message = "";
      await this.refresh();
    } catch (e) {
      this.error = msg(e);
    } finally {
      this.committing = false;
    }
  }
}

/** Singleton git-review store shared by the right panel. */
export const git = new GitStore();
