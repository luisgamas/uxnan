// Git review state for the right panel (Svelte 5 runes).
//
// Holds the changed-file list, staging actions, the selected file's diff and the
// commit message for the **active worktree**. The panel reloads on demand (after
// each action, on a manual refresh, and when the active worktree changes); the
// real-time 3 s status polling + Tauri events are a Phase 3 follow-up (FOR-DEV).

import { listen } from "@tauri-apps/api/event";
import {
  gitApply,
  gitCommit,
  gitDiff,
  gitDiscard,
  gitNumstat,
  gitPull,
  gitPush,
  gitSetWatch,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  worktreeStatus,
} from "$lib/api";
import { projects } from "$lib/state/projects.svelte";
import { toast, toastError } from "$lib/toast";
import { i18n } from "$lib/i18n";
import type { FileChange, GitStatusEvent } from "$lib/types";

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
  /** Added/deleted line counts vs HEAD, keyed by worktree-relative path. */
  numstat = $state<Record<string, { added: number; deleted: number }>>({});
  loading = $state(false);
  /** A staging/commit action is in flight (disables the action buttons). */
  busy = $state(false);
  error = $state<string | null>(null);
  /** Commit message composer. */
  message = $state("");
  committing = $state(false);
  /** Commits ahead / behind the upstream (for the push/pull bar). */
  ahead = $state(0);
  behind = $state(0);
  /** A push/pull is in flight. */
  syncing = $state(false);
  private listening = false;

  /** The file whose diff is open in the viewer, or null when closed. */
  selected = $state<{ file: string; staged: boolean } | null>(null);
  diff = $state("");
  diffLoading = $state(false);

  /** Files with a staged change / with a working-tree (or untracked) change. */
  staged = $derived(this.files.filter((f) => f.staged));
  changed = $derived(this.files.filter((f) => f.unstaged));

  /** Subscribe to the backend's live `git:status-changed` events (once). The
   *  watcher polls the worktree set via `gitSetWatch`; we apply updates for the
   *  worktree we're showing (and not mid-action, to avoid flicker). */
  async startListening(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    try {
      await listen<GitStatusEvent>("git:status-changed", (e) => {
        const ev = e.payload;
        if (ev.path !== this.path || this.busy || this.committing || this.syncing)
          return;
        this.files = ev.files.map(classify);
        this.ahead = ev.ahead;
        this.behind = ev.behind;
        void this.loadNumstat(ev.path);
        // Keep the project card badge live too.
        projects.setStatus(ev.path, {
          dirty: ev.files.length,
          ahead: ev.ahead,
          behind: ev.behind,
        });
      });
    } catch {
      // No Tauri event bus (e.g. the plain web preview) — on-demand only.
      this.listening = false;
    }
  }

  /** Point the panel at a worktree (or clear it), load its status, and tell the
   *  backend watcher to poll it. */
  async load(path: string | null): Promise<void> {
    this.path = path;
    this.error = null;
    this.selected = null;
    this.ahead = 0;
    this.behind = 0;
    void gitSetWatch(path).catch(() => {});
    if (!path) {
      this.files = [];
      this.numstat = {};
      return;
    }
    this.loading = true;
    try {
      this.files = (await gitStatus(path)).map(classify);
      void this.loadNumstat(path);
      const st = await worktreeStatus(path);
      this.ahead = st.ahead;
      this.behind = st.behind;
      // Keep the project card badge in sync (e.g. after a commit clears it).
      projects.setStatus(path, st);
    } catch (e) {
      this.error = msg(e);
      toastError(e);
      this.files = [];
    } finally {
      this.loading = false;
    }
  }

  /** Re-read the current worktree's status (no-op when none is selected). */
  refresh(): Promise<void> {
    return this.load(this.path);
  }

  /** Refresh the per-file added/deleted line counts (best-effort; only applied if
   *  we're still showing the same worktree when it resolves). */
  async loadNumstat(path: string): Promise<void> {
    try {
      const stats = await gitNumstat(path);
      if (this.path !== path) return;
      const map: Record<string, { added: number; deleted: number }> = {};
      for (const s of stats) map[s.path] = { added: s.added, deleted: s.deleted };
      this.numstat = map;
    } catch {
      // Non-fatal (e.g. transient git error); keep the last counts.
    }
  }

  /** Open the diff viewer for a file in the given area (staged or not). A diff
   *  that takes longer than 30 s is abandoned so the UI never hangs. */
  async openDiff(file: string, staged: boolean): Promise<void> {
    if (!this.path) return;
    this.selected = { file, staged };
    this.diff = "";
    this.diffLoading = true;
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("diff timed out")), 30_000),
      );
      this.diff = await Promise.race([gitDiff(this.path, file, staged), timeout]);
    } catch (e) {
      this.error = msg(e);
      toastError(e);
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
      toastError(e);
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

  /** Apply a single hunk (its sub-patch from the diff viewer) to the index or
   *  working tree, then refresh status + reload the open diff (closing the
   *  viewer if nothing is left). `stage`/`unstage` target the index; `discard`
   *  reverts the hunk in the working tree (destructive — confirmed in the UI). */
  async applyHunk(patch: string, action: "stage" | "unstage" | "discard"): Promise<void> {
    const path = this.path;
    const sel = this.selected;
    if (!path || !sel) return;
    this.busy = true;
    this.error = null;
    try {
      const cached = action !== "discard";
      const reverse = action !== "stage";
      await gitApply(path, patch, cached, reverse);
      await this.refresh();
      // Reload the diff in place; if the hunk was the last change, close it.
      this.selected = sel;
      await this.openDiff(sel.file, sel.staged);
      if (this.diff.trim().length === 0) this.closeDiff();
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.busy = false;
    }
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
      toast.success(i18n.t("toast.committed"));
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.committing = false;
    }
  }

  /** Push or pull the current branch, then refresh ahead/behind + status, and
   *  toast `okMsg` on success. */
  private async sync(fn: (path: string) => Promise<void>, okMsg: string): Promise<void> {
    const path = this.path;
    if (!path) return;
    this.syncing = true;
    this.error = null;
    try {
      await fn(path);
      await this.refresh();
      toast.success(okMsg);
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.syncing = false;
    }
  }
  push(): Promise<void> {
    return this.sync((p) => gitPush(p), i18n.t("toast.pushed"));
  }
  pull(): Promise<void> {
    return this.sync((p) => gitPull(p), i18n.t("toast.pulled"));
  }
}

/** Singleton git-review store shared by the right panel. */
export const git = new GitStore();
