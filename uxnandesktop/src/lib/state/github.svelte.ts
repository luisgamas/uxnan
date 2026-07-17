// GitHub integration store — sign-in status, the active worktree's repo/PR/CI
// context (polled), the status-bar rate-limit/notifications, and the section's
// PR/issue/run lists. Everything is `gh`-backed via `$lib/api`; no token is ever
// held here (see src-tauri/src/github.rs).

import {
  githubStatus,
  githubRepoContext,
  githubRateLimit,
  githubNotificationsCount,
  githubPrList,
  githubIssueList,
  githubRunList,
} from "$lib/api";
import type {
  GithubStatus,
  RepoContext,
  RateLimit,
  PrListItem,
  IssueListItem,
  RunListItem,
} from "$lib/types";
import { app } from "./app.svelte";
import { projects } from "./projects.svelte";

class GithubStore {
  /** Sign-in status (gh installed? authenticated? login/host/scopes). */
  status = $state<GithubStatus | null>(null);
  /** Whether at least one status read completed (so the UI doesn't flash). */
  statusChecked = $state(false);

  /** The active worktree's context (repo + branch + current-branch PR). */
  context = $state<RepoContext | null>(null);
  /** The worktree path `context` is for (guards against stale async results). */
  contextPath = $state<string | null>(null);
  /** Whether a context load is in flight. */
  contextLoading = $state(false);
  /** Per-path context cache so recently-visited worktree cards keep their PR
   *  badge without re-fetching every switch. */
  contextByPath = $state<Record<string, RepoContext | null>>({});

  /** Core REST rate limit (status-bar gauge). */
  rateLimit = $state<RateLimit | null>(null);
  /** Unread notifications count (status-bar badge; 0 when disabled). */
  notifications = $state(0);

  // --- Section (full-screen) is scoped to an EXPLICITLY-SELECTED repo -------
  // (independent of the active worktree — the right-panel tab is the per-worktree
  // view). The user picks the repo from the section's repo selector.
  /** The repo path selected in the GitHub section. */
  sectionRepoPath = $state<string | null>(null);
  /** The selected repo's context (owner/repo + current branch + its PR). */
  sectionContext = $state<RepoContext | null>(null);
  /** Whether the section context is loading. */
  sectionContextLoading = $state(false);

  // --- Section data (scoped to `sectionRepoPath`) --------------------------
  prs = $state<PrListItem[]>([]);
  prsLoading = $state(false);
  prsError = $state<string | null>(null);

  issues = $state<IssueListItem[]>([]);
  issuesLoading = $state(false);
  issuesError = $state<string | null>(null);

  runs = $state<RunListItem[]>([]);
  runsLoading = $state(false);
  runsError = $state<string | null>(null);

  /** Monotonic token so a slow response for an old worktree can't clobber a newer
   *  one (worktree switches are frequent). */
  #ctxSeq = 0;
  #timer: ReturnType<typeof setInterval> | null = null;

  /** Whether GitHub features are usable (gh present + signed in). A `$derived`, so
   *  it re-fires downstream effects only when the *boolean* flips — not on every
   *  `status` reassignment from a poll (which would otherwise thrash the UI). */
  available = $derived(
    this.status?.ghInstalled === true && this.status?.authenticated === true,
  );

  /** The registered git repos the section's selector offers (GitHub needs git). */
  get sectionRepoOptions(): { path: string; name: string }[] {
    return app.repos
      .filter((r) => r.isGit !== false)
      .map((r) => ({ path: r.path, name: r.name }));
  }

  /** Make sure the section has a repo selected. Defaults (once) to the active
   *  worktree's repo, then the active project, then the first git repo. */
  ensureSectionRepo(): void {
    if (this.sectionRepoPath && app.repos.some((r) => r.path === this.sectionRepoPath)) {
      return;
    }
    const fallback =
      projects.activeWorktreePath ??
      projects.activeRepo?.path ??
      this.sectionRepoOptions[0]?.path ??
      null;
    if (fallback) void this.selectSectionRepo(fallback);
  }

  /** Select a repo for the section: load its context + the current pane's list. */
  async selectSectionRepo(path: string): Promise<void> {
    this.sectionRepoPath = path;
    await this.loadSectionContext();
  }

  /** Load the selected repo's context (owner/repo + branch + PR). */
  async loadSectionContext(): Promise<void> {
    const path = this.sectionRepoPath;
    if (!path || !this.available) {
      this.sectionContext = null;
      return;
    }
    this.sectionContextLoading = true;
    try {
      this.sectionContext = await githubRepoContext(path);
    } catch {
      this.sectionContext = null;
    } finally {
      this.sectionContextLoading = false;
    }
  }

  /** Refresh sign-in status. Best-effort; leaves the last value on failure. Only
   *  reassigns when the value actually changed, to avoid needless re-renders. */
  async refreshStatus(): Promise<void> {
    let next: GithubStatus;
    try {
      next = await githubStatus();
    } catch {
      next = {
        ghInstalled: false,
        authenticated: false,
        login: null,
        host: null,
        scopes: [],
        message: "Could not read GitHub status",
      };
    }
    if (!sameJson(next, this.status)) this.status = next;
    this.statusChecked = true;
  }

  /** Load the GitHub context for a worktree path. Clears when it isn't a GitHub
   *  repo, when no path is active, or when not signed in. */
  async loadContext(path: string | null): Promise<void> {
    const seq = ++this.#ctxSeq;
    this.contextPath = path;
    if (!path || !this.available) {
      this.context = null;
      return;
    }
    this.contextLoading = true;
    try {
      const ctx = await githubRepoContext(path);
      if (seq !== this.#ctxSeq) return; // a newer request superseded us
      // Only reassign when the value changed, so a steady poll doesn't churn the
      // sidebar badges / the panel (which read these).
      if (!sameJson(ctx, this.context)) this.context = ctx;
      if (!sameJson(ctx, this.contextByPath[path])) {
        this.contextByPath = { ...this.contextByPath, [path]: ctx };
      }
    } catch {
      if (seq !== this.#ctxSeq) return;
      this.context = null;
    } finally {
      if (seq === this.#ctxSeq) this.contextLoading = false;
    }
  }

  /** The cached context for a worktree path (for sidebar-card badges). */
  contextFor(path: string | null | undefined): RepoContext | null {
    if (!path) return null;
    return this.contextByPath[path] ?? null;
  }

  /** Re-read the current worktree's context (used by the poll + manual refresh). */
  async refreshContext(): Promise<void> {
    await this.loadContext(app_activePath());
  }

  /** Start polling the active worktree's context (+ rate limit / notifications)
   *  on the configured interval, paused when the window is hidden. Returns a
   *  cleanup. Safe to call repeatedly (restarts the timer). */
  startPolling(): () => void {
    this.stopPolling();
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (!this.available) return;
      void this.refreshContext();
      void this.refreshRateLimit();
      if (app.settings.github?.notificationsEnabled) void this.refreshNotifications();
    };
    const seconds = Math.max(0, app.settings.github?.pollSeconds ?? 45);
    if (seconds > 0) this.#timer = setInterval(tick, seconds * 1000);
    return () => this.stopPolling();
  }

  stopPolling(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Refresh the rate-limit gauge (the endpoint is free). */
  async refreshRateLimit(): Promise<void> {
    if (!this.available) return;
    try {
      const next = await githubRateLimit();
      if (!sameJson(next, this.rateLimit)) this.rateLimit = next;
    } catch {
      /* leave last value */
    }
  }

  /** Refresh the unread-notifications count. */
  async refreshNotifications(): Promise<void> {
    if (!this.available) {
      this.notifications = 0;
      return;
    }
    try {
      this.notifications = await githubNotificationsCount();
    } catch {
      /* leave last value */
    }
  }

  /** Load the PR list for the section's selected repo. */
  async loadPrs(state = "open", search: string | null = null): Promise<void> {
    const path = this.sectionRepoPath;
    if (!path || !this.available) {
      this.prs = [];
      return;
    }
    this.prsLoading = true;
    this.prsError = null;
    try {
      this.prs = await githubPrList(path, state, search, 50);
    } catch (e) {
      this.prs = [];
      this.prsError = String(e);
    } finally {
      this.prsLoading = false;
    }
  }

  /** Load the issue list for the section's selected repo. */
  async loadIssues(state = "open", search: string | null = null): Promise<void> {
    const path = this.sectionRepoPath;
    if (!path || !this.available) {
      this.issues = [];
      return;
    }
    this.issuesLoading = true;
    this.issuesError = null;
    try {
      this.issues = await githubIssueList(path, state, search, 50);
    } catch (e) {
      this.issues = [];
      this.issuesError = String(e);
    } finally {
      this.issuesLoading = false;
    }
  }

  /** Load recent workflow runs for the selected repo. `onlyBranch` scopes to that
   *  repo's checked-out branch. */
  async loadRuns(onlyBranch = false): Promise<void> {
    const path = this.sectionRepoPath;
    if (!path || !this.available) {
      this.runs = [];
      return;
    }
    this.runsLoading = true;
    this.runsError = null;
    try {
      const branch = onlyBranch ? (this.sectionContext?.branch ?? null) : null;
      this.runs = await githubRunList(path, branch, 30);
    } catch (e) {
      this.runs = [];
      this.runsError = String(e);
    } finally {
      this.runsLoading = false;
    }
  }
}

/** The active worktree path (from the projects store) — the per-worktree context
 *  used by the right-panel GitHub tab + sidebar badges. */
function app_activePath(): string | null {
  return projects.activeWorktreePath ?? null;
}

/** Cheap structural equality via JSON, so we skip `$state` reassignments (and the
 *  re-renders they trigger) when a poll returns an identical value. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const github = new GithubStore();
