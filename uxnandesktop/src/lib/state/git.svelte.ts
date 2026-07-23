// Git review state for the right panel (Svelte 5 runes).
//
// Holds the changed-file list, staging actions, the selected file's diff and the
// commit message for the **active worktree**. The panel reloads on demand (after
// each action, on a manual refresh, and when the active worktree changes); the
// real-time 3 s status polling + Tauri events are a Phase 3 follow-up (FOR-DEV).

import { listen } from "@tauri-apps/api/event";
import {
  generateCommitMessage,
  gitApply,
  gitCommit,
  gitDiff,
  gitImageDiff,
  gitDiscard,
  gitFetch,
  gitNumstat,
  gitPull,
  gitPush,
  gitSetWatch,
  gitShow,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  worktreeStatus,
} from "$lib/api";
import { projects } from "$lib/state/projects.svelte";
import { history } from "$lib/state/history.svelte";
import { app } from "$lib/state/app.svelte";
import { github } from "$lib/state/github.svelte";
import { toast, toastError } from "$lib/toast";
import { i18n } from "$lib/i18n";
import { isImagePath } from "$lib/diff";
import { commitFileDiff } from "$lib/diffParse";
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
  busyAction = $state<{ kind: "stage" | "unstage" | "discard"; file: string } | null>(null);
  error = $state<string | null>(null);
  /** Commit message composer: subject line. */
  message = $state("");
  /** Optional extended description (commit body) — collapsed in the composer. */
  body = $state("");
  /** Optional `Co-authored-by:` entries, each `Name <email>` — collapsed. */
  coAuthors = $state<string[]>([]);
  /** Amend the previous commit instead of creating a new one. */
  amend = $state(false);
  /** Append a `Signed-off-by:` trailer (git `-s`). */
  signOff = $state(false);
  committing = $state(false);
  /** An AI commit-message draft is in flight (disables the Generate button). */
  aiGenerating = $state(false);
  /** Commits ahead / behind the upstream (for the push/pull bar). */
  ahead = $state(0);
  behind = $state(0);
  /** A push/pull is in flight. */
  syncing = $state(false);
  syncingAction = $state<"push" | "pull" | null>(null);
  /** A remote fetch (checking for new upstream commits) is in flight. */
  fetching = $state(false);
  private listening = false;

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
        if (
          ev.path !== this.path ||
          this.busy ||
          this.committing ||
          this.syncing ||
          this.fetching
        )
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
      const files = (await gitStatus(path)).map(classify);
      if (this.path !== path) return;
      this.files = files;
      void this.loadNumstat(path);
      const st = await worktreeStatus(path);
      if (this.path !== path) return;
      this.ahead = st.ahead;
      this.behind = st.behind;
      // Keep the project card badge in sync (e.g. after a commit clears it).
      projects.setStatus(path, st);
    } catch (e) {
      if (this.path !== path) return;
      this.error = msg(e);
      toastError(e);
      this.files = [];
    } finally {
      if (this.path === path) this.loading = false;
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

  /** Run a staging action then refresh, surfacing any error. */
  private async op(
    action: { kind: "stage" | "unstage" | "discard"; file: string },
    fn: (path: string) => Promise<void>,
  ): Promise<void> {
    const path = this.path;
    if (!path) return;
    this.busy = true;
    this.busyAction = action;
    this.error = null;
    try {
      await fn(path);
      await this.refresh();
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.busy = false;
      this.busyAction = null;
    }
  }

  stage(file: string): Promise<void> {
    return this.op({ kind: "stage", file }, (p) => gitStage(p, file));
  }
  unstage(file: string): Promise<void> {
    return this.op({ kind: "unstage", file }, (p) => gitUnstage(p, file));
  }
  stageAll(): Promise<void> {
    return this.op({ kind: "stage", file: "*" }, (p) => gitStageAll(p));
  }
  unstageAll(): Promise<void> {
    return this.op({ kind: "unstage", file: "*" }, (p) => gitUnstageAll(p));
  }
  discard(file: string, untracked: boolean): Promise<void> {
    return this.op({ kind: "discard", file }, (p) => gitDiscard(p, file, untracked));
  }

  /** Reload the status if the panel is currently showing `path` (used by a diff
   *  tab after it applies a hunk in that worktree). */
  refreshIfWatching(path: string): void {
    if (this.path === path) void this.refresh();
  }

  /** Compose the full commit message from the composer fields: the subject, the
   *  optional body (after a blank line), and a trailer block with any
   *  `Co-authored-by:` entries. `Signed-off-by:` is appended by git itself (the
   *  `signOff` flag → `-s`) so it uses the configured identity. */
  buildCommitMessage(): string {
    const subject = this.message.trim();
    const body = this.body.trim();
    const trailers = this.coAuthors
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => `Co-authored-by: ${c}`);
    let out = subject;
    if (body) out += `\n\n${body}`;
    if (trailers.length > 0) out += `\n\n${trailers.join("\n")}`;
    return out;
  }

  /** Clear the composer (subject + all optional fields) after a successful commit. */
  private resetComposer(): void {
    this.message = "";
    this.body = "";
    this.coAuthors = [];
    this.amend = false;
    this.signOff = false;
  }

  /** Draft the commit message with the configured AI agent (Settings → AI
   *  commit) from the staged diff. Fills the subject (first line) and, when the
   *  agent returns one, the body (the rest), overwriting whatever is there. */
  async generateMessage(): Promise<void> {
    const path = this.path;
    if (!path || this.aiGenerating) return;
    this.aiGenerating = true;
    this.error = null;
    try {
      const raw = (await generateCommitMessage(path)).trim();
      const nl = raw.indexOf("\n");
      if (nl === -1) {
        this.message = raw;
      } else {
        this.message = raw.slice(0, nl).trim();
        const body = raw.slice(nl + 1).trim();
        if (body) this.body = body;
      }
      toast.success(i18n.t("toast.aiCommitGenerated"));
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.aiGenerating = false;
    }
  }

  /** Commit the staged changes (or amend HEAD); clears the composer and refreshes
   *  on success. The message is composed from the subject + optional body +
   *  co-author trailers. */
  async commit(): Promise<void> {
    const path = this.path;
    const message = this.buildCommitMessage().trim();
    if (!path || !this.message.trim()) return;
    this.committing = true;
    this.error = null;
    try {
      await gitCommit(path, message, this.amend, this.signOff);
      this.resetComposer();
      history.markStale();
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
  private async sync(
    action: "push" | "pull",
    fn: (path: string) => Promise<void>,
    okMsg: string,
  ): Promise<void> {
    const path = this.path;
    if (!path) return;
    this.syncing = true;
    this.syncingAction = action;
    this.error = null;
    try {
      await fn(path);
      history.markStale();
      await this.refresh();
      toast.success(okMsg);
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.syncing = false;
      this.syncingAction = null;
    }
  }
  async push(): Promise<void> {
    await this.sync("push", (p) => gitPush(p), i18n.t("toast.pushed"));
    await this.offerCreatePr();
  }
  pull(): Promise<void> {
    return this.sync("pull", (p) => gitPull(p), i18n.t("toast.pulled"));
  }

  /** Fetch the current worktree's remote and refresh ahead/behind so the user can
   *  see whether there are new upstream commits to pull. On success, toasts either
   *  how many new commits are waiting (the pull button then appears via the
   *  ahead/behind sync bar) or that everything is already up to date. Read-only:
   *  never touches the working tree. */
  async fetchRemote(): Promise<void> {
    const path = this.path;
    if (!path || this.fetching) return;
    this.fetching = true;
    this.error = null;
    try {
      const st = await gitFetch(path);
      if (this.path === path) {
        this.ahead = st.ahead;
        this.behind = st.behind;
        // Keep the project card badge in sync with the freshly fetched state.
        projects.setStatus(path, st);
      }
      if (st.behind > 0) {
        toast.success(i18n.plural(st.behind, "toast.fetchBehindOne", "toast.fetchBehindOther"));
      } else {
        toast.success(i18n.t("toast.fetchUpToDate"));
      }
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.fetching = false;
    }
  }

  /** After a push, if the branch is a GitHub repo with no PR yet, offer a "Create
   *  PR" action (the Zed pattern). Best-effort; silent when GitHub is unavailable. */
  private async offerCreatePr(): Promise<void> {
    try {
      await github.refreshContext();
      const ctx = github.context;
      if (github.available && ctx && ctx.branch && !ctx.pr) {
        toast(i18n.t("github.toast.createPrPrompt"), {
          action: {
            label: i18n.t("github.pr.create"),
            onClick: () => app.openGitHub("pulls"),
          },
        });
      }
    } catch {
      /* ignore — the toast is a convenience, not a guarantee */
    }
  }
}

/** Singleton git-review store shared by the right panel. */
export const git = new GitStore();

/** Per-tab state for a **diff viewer** opened as a center tab. Self-contained —
 *  it carries its own `worktree` so it keeps working when the right panel
 *  switches to another worktree (or is closed). One instance per diff tab,
 *  registered in the terminals store and rendered by `DiffPane.svelte`. */
export class DiffViewerState {
  readonly worktree: string;
  /** Worktree-relative path being diffed. Mutable so a file-tab rename/move can
   *  re-point the same Changes view at the file's new location (see `repoint`). */
  file = $state("");
  staged = $state(false);
  /** Image files are diffed visually (before/after) instead of as text. */
  get isImage(): boolean {
    return isImagePath(this.file);
  }
  diff = $state("");
  /** Before/after image data URLs (image diffs only); null = that side absent. */
  imageOld = $state<string | null>(null);
  imageNew = $state<string | null>(null);
  diffLoading = $state(true);
  error = $state<string | null>(null);
  /** Called when applying a hunk leaves the file with no remaining diff, so the
   *  owning tab can close itself. */
  private onEmpty: () => void;

  constructor(worktree: string, file: string, staged: boolean, onEmpty: () => void) {
    this.worktree = worktree;
    this.file = file;
    this.staged = staged;
    this.onEmpty = onEmpty;
    void this.reload();
  }

  /** Switch between the staged (index-vs-HEAD) and unstaged (worktree-vs-index)
   *  diff, reloading. No-op when already on that side. */
  setStaged(staged: boolean): void {
    if (this.staged === staged) return;
    this.staged = staged;
    void this.reload();
  }

  /** Re-point at a moved file (a file-tab rename/folder-move within the same
   *  worktree) and reload, so the Changes view survives the rename. */
  repoint(file: string): void {
    this.file = file;
    void this.reload();
  }

  /** (Re)load the diff. For images this loads the before/after versions; for text
   *  the unified diff (abandoned after 30 s so the UI never hangs). */
  async reload(): Promise<void> {
    this.diffLoading = true;
    this.error = null;
    try {
      if (this.isImage) {
        const res = await gitImageDiff(this.worktree, this.file, this.staged);
        this.imageOld = res.old ? `data:${res.old.mime};base64,${res.old.base64}` : null;
        this.imageNew = res.new ? `data:${res.new.mime};base64,${res.new.base64}` : null;
        return;
      }
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("diff timed out")), 30_000),
      );
      this.diff = await Promise.race([gitDiff(this.worktree, this.file, this.staged), timeout]);
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.diffLoading = false;
    }
  }

  /** The file changed on disk → reload (diffs are read-only, always safe). */
  noteExternalChange(): void {
    void this.reload();
  }

  /** Apply a single hunk (its sub-patch) to this diff's own worktree, then
   *  reload; if nothing is left, ask the owning tab to close. Refreshes the
   *  right panel only when it happens to be showing the same worktree. */
  async applyHunk(patch: string, action: "stage" | "unstage" | "discard"): Promise<void> {
    this.error = null;
    try {
      const cached = action !== "discard";
      const reverse = action !== "stage";
      await gitApply(this.worktree, patch, cached, reverse);
      git.refreshIfWatching(this.worktree);
      await this.reload();
      if (this.diff.trim().length === 0) this.onEmpty();
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    }
  }
}

/** Per-tab state for a **commit viewer** opened as a center tab (from the History
 *  tab). Read-only: shows the full diff a commit introduced (vs its first
 *  parent). Self-contained — it carries its own `worktree` so it keeps working
 *  when the right panel switches worktree. One instance per commit tab, rendered
 *  by `CommitPane.svelte`. */
export class CommitViewerState {
  readonly worktree: string;
  readonly hash: string;
  readonly subject: string;
  /** When set, the viewer shows only this file's slice of the commit diff. */
  readonly file: string | null;
  diff = $state("");
  diffLoading = $state(true);
  error = $state<string | null>(null);

  constructor(worktree: string, hash: string, subject: string, file?: string) {
    this.worktree = worktree;
    this.hash = hash;
    this.subject = subject;
    this.file = file ?? null;
    void this.reload();
  }

  /** (Re)load the commit diff. Abandoned after 30 s so the UI never hangs. When
   *  scoped to a `file`, the full commit diff is sliced to that file's chunk. */
  async reload(): Promise<void> {
    this.diffLoading = true;
    this.error = null;
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("diff timed out")), 30_000),
      );
      const full = await Promise.race([gitShow(this.worktree, this.hash), timeout]);
      this.diff = this.file ? commitFileDiff(full, this.file) : full;
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.diffLoading = false;
    }
  }
}
