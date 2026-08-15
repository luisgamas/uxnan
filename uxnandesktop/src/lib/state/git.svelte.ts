// Git review state for the right panel (Svelte 5 runes).
//
// Holds the changed-file list, staging actions, the selected file's diff and the
// commit message for the **active worktree**, on whichever machine that worktree
// lives (`$lib/gitRouter` decides; this store never asks "is it remote?" itself
// beyond the two places where the *behaviour* genuinely differs).
//
// Two of those differences are worth knowing before reading the code:
//
// - **A remote worktree has no watcher.** The backend's live 3 s snapshots are
//   this machine's git being polled; polling a host would be a shell start every
//   three seconds on someone else's computer, per worktree. So a remote review
//   refreshes when it is opened, after every action taken here, and when the
//   user asks — and `remote` is exposed so the panel can say so rather than
//   letting a stale list look live.
// - **The agent that drafts a commit message runs here, whatever the project.**
//   It is this machine's CLI and sign-in; only the diff comes from the host.

import { listen } from "@tauri-apps/api/event";
import { gitNumstat, gitSetWatch } from "$lib/api";
import {
  applyOn,
  commitOn,
  diffOn,
  discardOn,
  generateCommitMessageOn,
  imageDiffOn,
  reviewOn,
  showOn,
  stageAllOn,
  stageOn,
  syncOn,
  unstageAllOn,
  unstageOn,
} from "$lib/gitRouter";
import { sessions } from "$lib/state/sessions.svelte";
import { isLocalTarget, LOCAL_TARGET, sshHostId, type TargetId } from "$lib/target";
import { projects } from "$lib/state/projects.svelte";
import { history } from "$lib/state/history.svelte";
import { app } from "$lib/state/app.svelte";
import { github } from "$lib/state/github.svelte";
import { toast, toastError } from "$lib/toast";
import { i18n } from "$lib/i18n";
import { isImagePath } from "$lib/diff";
import { commitFileDiff } from "$lib/diffParse";
import type { FileChange, GitStatusEvent } from "$lib/types";

/** Whether a failure is "that host is not connected yet" — a state, not a
 *  fault. Matched on the backend's own code, like the file tree does, so the
 *  wording can change freely. */
function isNotConnected(e: unknown): boolean {
  return (
    !!e && typeof e === "object" && "code" in e && (e as { code: unknown }).code === "NOT_CONNECTED"
  );
}

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
  /** The machine that worktree is on. Held next to the path because neither
   *  means anything alone: the same absolute path names a different folder on
   *  every machine, which is why every call here goes through `$lib/gitRouter`
   *  with both. */
  target = $state<TargetId>(LOCAL_TARGET);
  files = $state<FileEntry[]>([]);
  /** Added/deleted line counts vs HEAD, keyed by worktree-relative path. */
  numstat = $state<Record<string, { added: number; deleted: number }>>({});
  loading = $state(false);
  /** A staging/commit action is in flight (disables the action buttons). */
  busy = $state(false);
  busyAction = $state<{ kind: "stage" | "unstage" | "discard"; file: string } | null>(null);
  error = $state<string | null>(null);
  /** The worktree is on a host that has not connected yet. Not an error: it is
   *  the ordinary state between starting the app and the host coming up, and it
   *  fills itself in from `retryForHost` — the same shape the file tree uses,
   *  because the alternative is a red line the user has to clear by switching
   *  projects and back. */
  awaitingHost = $state(false);
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
  /** Async guards cover fast A → B → A worktree switches and overlapping manual
   *  refreshes; comparing only the path cannot reject the first A response. */
  private loadSeq = 0;
  private numstatSeq = 0;
  /** Last HEAD seen for each watched path. Keeping the baseline per worktree
   *  catches commits made while the user was looking at another workspace. */
  private headsByPath = new Map<string, string | null>();

  /** Whether the reviewed worktree is on another machine. The panel reads it to
   *  say that the list refreshes on demand rather than by itself, and to leave
   *  out the two things that only this machine's git can do. */
  remote = $derived(!isLocalTarget(this.target));

  /** The connection this worktree's mutations must run against, or `undefined`
   *  when the host is not connected — which is a refusal, never a zero. Local
   *  work needs none. */
  private get generation(): number | undefined {
    const host = sshHostId(this.target);
    return host === null ? undefined : sessions.generationOf(host);
  }

  /** Whether an action can be taken at all: a host that dropped its connection
   *  can still be *shown*, but nothing may be sent to it. */
  actionable = $derived.by(() => {
    const host = sshHostId(this.target);
    return host === null || sessions.generationOf(host) !== undefined;
  });

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
        // The watcher polls *this* machine. A host's worktree can carry the same
        // absolute path, so the target is checked before the path — otherwise a
        // local folder of the same name would overwrite a remote review with its
        // own file list.
        if (this.remote || ev.path !== this.path) return;

        const hadHead = this.headsByPath.has(ev.path);
        const previousHead = this.headsByPath.get(ev.path);
        this.headsByPath.set(ev.path, ev.head);
        if (
          (hadHead && previousHead !== ev.head) ||
          (!hadHead && history.loadedHeadDiffers(ev.path, ev.head))
        ) {
          // A clean tree can still have a new HEAD (external commit/amend). The
          // changed snapshot is the signal History and GitHub were missing.
          history.refreshIfLoaded(ev.path);
          void github.refreshContext();
        }

        if (this.busy || this.committing || this.syncing || this.fetching) return;
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

  /** Point the panel at a worktree on a machine (or clear it), load its status,
   *  and tell the backend watcher to poll it — only when it is this machine's,
   *  since that watcher can only see this one. */
  async load(path: string | null, target: TargetId = LOCAL_TARGET): Promise<void> {
    const seq = ++this.loadSeq;
    const pathChanged = this.path !== path || this.target !== target;
    this.path = path;
    this.target = target;
    this.error = null;
    this.awaitingHost = false;
    this.ahead = 0;
    this.behind = 0;
    if (pathChanged) {
      // Never display the previous worktree's files or line counts while the
      // newly selected path is still loading.
      this.files = [];
      this.numstat = {};
      this.numstatSeq++;
    }
    // A remote worktree unwatches whatever this machine was watching: there is
    // nothing here to poll, and polling a host every three seconds would be a
    // shell start on someone else's computer for as long as the panel is open.
    void gitSetWatch(isLocalTarget(target) ? path : null).catch(() => {});
    if (!path) {
      this.loading = false;
      this.numstatSeq++;
      this.files = [];
      this.numstat = {};
      return;
    }
    this.loading = true;
    try {
      // One call for both machines. Locally it is still the three calls it
      // always was; on a host it is a single command, because each one there
      // costs a shell start (`$lib/gitRouter`).
      const review = await reviewOn(target, path);
      if (seq !== this.loadSeq || this.path !== path) return;
      if (!review.isRepo) {
        // "Not a repository", "no git installed" or "the shell could not be
        // named" — all of which must read as *not read*, never as a clean tree.
        this.files = [];
        this.numstat = {};
        this.error = i18n.t("git.remoteNotRead");
        return;
      }
      this.files = review.files.map(classify);
      const map: Record<string, { added: number; deleted: number }> = {};
      for (const n of review.numstat) map[n.path] = { added: n.added, deleted: n.deleted };
      this.numstat = map;
      this.numstatSeq++;
      this.ahead = review.status.ahead;
      this.behind = review.status.behind;
      // A host answers with its HEAD, so History can tell it is looking at an
      // older one without a second round trip.
      if (review.head !== null) {
        const previous = this.headsByPath.get(path);
        this.headsByPath.set(path, review.head);
        if (previous !== undefined && previous !== review.head) history.refreshIfLoaded(path);
      }
      // Keep the project card badge in sync (e.g. after a commit clears it).
      projects.setStatus(path, review.status);
    } catch (e) {
      if (seq !== this.loadSeq || this.path !== path) return;
      this.files = [];
      this.numstat = {};
      // A host that is not up yet is said plainly and silently — a toast on
      // every cold start, for a state the app is about to resolve by itself,
      // is noise the user cannot act on.
      // Structural, not just the error's word for it: only a review that is of
      // a host can be waiting for one (see the note in `fileTree`).
      this.awaitingHost = isNotConnected(e) && this.remote;
      this.error = this.awaitingHost ? null : msg(e);
      if (!this.awaitingHost) toastError(e);
    } finally {
      if (seq === this.loadSeq && this.path === path) this.loading = false;
    }
  }

  /** Re-read the current worktree's status (no-op when none is selected). On a
   *  host this is the *only* thing that updates the list, so it runs after every
   *  action here and behind the panel's refresh control. */
  refresh(): Promise<void> {
    return this.load(this.path, this.target);
  }

  /** Refresh the per-file added/deleted line counts (best-effort; only applied if
   *  we're still showing the same worktree when it resolves).
   *
   *  Local only, and called only from the watcher's snapshot: a host answers its
   *  counts inside `reviewOn`, so asking again would be a second shell start for
   *  something already in hand. */
  async loadNumstat(path: string): Promise<void> {
    const seq = ++this.numstatSeq;
    try {
      const stats = await gitNumstat(path);
      if (seq !== this.numstatSeq || this.path !== path) return;
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
    fn: (path: string, target: TargetId, generation?: number) => Promise<void>,
  ): Promise<void> {
    const path = this.path;
    if (!path) return;
    const target = this.target;
    const generation = this.generation;
    this.busy = true;
    this.busyAction = action;
    this.error = null;
    try {
      await fn(path, target, generation);
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
    return this.op({ kind: "stage", file }, (p, t, g) => stageOn(t, p, file, g));
  }
  unstage(file: string): Promise<void> {
    return this.op({ kind: "unstage", file }, (p, t, g) => unstageOn(t, p, file, g));
  }
  stageAll(): Promise<void> {
    return this.op({ kind: "stage", file: "*" }, (p, t, g) => stageAllOn(t, p, g));
  }
  unstageAll(): Promise<void> {
    return this.op({ kind: "unstage", file: "*" }, (p, t, g) => unstageAllOn(t, p, g));
  }
  discard(file: string, untracked: boolean): Promise<void> {
    return this.op({ kind: "discard", file }, (p, t, g) => discardOn(t, p, file, untracked, g));
  }

  /** Reload the status if the panel is currently showing `path` (used by a diff
   *  tab after it applies a hunk in that worktree). */
  refreshIfWatching(path: string, target: TargetId = LOCAL_TARGET): void {
    if (this.path === path && this.target === target) void this.refresh();
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
      const raw = (await generateCommitMessageOn(this.target, path)).trim();
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
      await commitOn(this.target, path, message, this.amend, this.signOff, this.generation);
      this.resetComposer();
      history.refreshIfLoaded(path);
      await this.refresh();
      void github.refreshContext();
      // Our own git actions move more than this worktree's card: a commit here
      // changes what a sibling worktree is ahead/behind by, and those cards are
      // only re-read by the background sweep.
      projects.requestStatusSweep();
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
  private async sync(action: "push" | "pull", okMsg: string): Promise<void> {
    const path = this.path;
    if (!path) return;
    this.syncing = true;
    this.syncingAction = action;
    this.error = null;
    try {
      await syncOn(this.target, path, action, this.generation);
      history.refreshIfLoaded(path);
      await this.refresh();
      void github.refreshContext();
      projects.requestStatusSweep();
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
    await this.sync("push", i18n.t("toast.pushed"));
    // The GitHub side of this reads *this* machine's repository, so it is only
    // offered for a worktree that is on it.
    if (!this.remote) await this.offerCreatePr();
  }
  pull(): Promise<void> {
    return this.sync("pull", i18n.t("toast.pulled"));
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
      const st = await syncOn(this.target, path, "fetch", this.generation);
      if (this.path === path) {
        this.ahead = st.ahead;
        this.behind = st.behind;
        // Keep the project card badge in sync with the freshly fetched state.
        projects.setStatus(path, st);
      }
      // A fetch updates every worktree's notion of the remote, not just this one.
      projects.requestStatusSweep();
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
            onClick: () => {
              // Open the inline GitHub view (Pull Requests) for the active repo.
              const p = projects.activeRepo?.path;
              if (!p) return;
              void github.selectSectionRepo(p);
              app.openGithubInline("pulls");
            },
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
  /** The machine that worktree is on, carried for the same reason as the path:
   *  a tab that outlives the panel must not start reading this machine's copy of
   *  a folder that lives on a host. */
  readonly target: TargetId;
  /** The connection a hunk action must run against, read at the moment of the
   *  action — the tab can outlive a reconnection, and the generation it was
   *  opened with would by then name a connection that no longer exists. */
  private get generation(): number | undefined {
    const host = sshHostId(this.target);
    return host === null ? undefined : sessions.generationOf(host);
  }
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

  constructor(
    worktree: string,
    file: string,
    staged: boolean,
    onEmpty: () => void,
    target: TargetId = LOCAL_TARGET,
  ) {
    this.worktree = worktree;
    this.target = target;
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
        const res = await imageDiffOn(this.target, this.worktree, this.file, this.staged);
        this.imageOld = res.old ? `data:${res.old.mime};base64,${res.old.base64}` : null;
        this.imageNew = res.new ? `data:${res.new.mime};base64,${res.new.base64}` : null;
        return;
      }
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("diff timed out")), 30_000),
      );
      this.diff = await Promise.race([
        diffOn(this.target, this.worktree, this.file, this.staged),
        timeout,
      ]);
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
      await applyOn(this.target, this.worktree, patch, cached, reverse, this.generation);
      git.refreshIfWatching(this.worktree, this.target);
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
  /** The machine the commit is on — same reason as `DiffViewerState`. */
  readonly target: TargetId;
  readonly hash: string;
  readonly subject: string;
  /** When set, the viewer shows only this file's slice of the commit diff. */
  readonly file: string | null;
  diff = $state("");
  diffLoading = $state(true);
  error = $state<string | null>(null);

  constructor(
    worktree: string,
    hash: string,
    subject: string,
    file?: string,
    target: TargetId = LOCAL_TARGET,
  ) {
    this.worktree = worktree;
    this.target = target;
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
      const full = await Promise.race([showOn(this.target, this.worktree, this.hash), timeout]);
      this.diff = this.file ? commitFileDiff(full, this.file) : full;
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    } finally {
      this.diffLoading = false;
    }
  }
}
