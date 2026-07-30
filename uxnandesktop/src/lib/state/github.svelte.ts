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
import { app, type GithubSection } from "./app.svelte";
import { projects } from "./projects.svelte";
import { samePath, canonicalFor } from "$lib/pathid";

/** How many non-active worktrees may have their PR badge re-read per poll tick.
 *  Each one is a `gh` call against the account's API rate limit, so the badges
 *  catch up over a few ticks instead of all at once. */
const BADGE_TICK_CAP = 2;

/** An item the inline section should open on arrival, requested from outside it. */
export type PendingDetail =
  | { kind: "pr"; number: number }
  | { kind: "issue"; number: number }
  | { kind: "run"; id: number; title: string };

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
  /** Advances after every successful active-context read, even when the JSON is
   *  identical. The right-panel digest uses it as its poll tick for repo-wide
   *  PR, run and issue lists, which are separate API reads. */
  contextRevision = $state(0);
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
  /** Same guard for the *section's* context (the two are independent loads). */
  #sectionSeq = 0;
  /** Round-robin cursor over the non-active worktrees whose badges we refresh. */
  #badgeCursor = 0;
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
   *  worktree's repo, then the active project, then the first git repo.
   *  Path spellings are compared with `samePath`: git hands back `C:/repo` where
   *  the project was registered as `C:\repo`, and a `===` here read the repo the
   *  user explicitly picked as "unknown" and silently replaced it with the active
   *  worktree's — i.e. opened a different project's GitHub than the one asked for. */
  ensureSectionRepo(): void {
    if (this.sectionRepoPath && app.repos.some((r) => samePath(r.path, this.sectionRepoPath!))) {
      return;
    }
    const fallback =
      projects.activeWorktreePath ??
      projects.activeRepo?.path ??
      this.sectionRepoOptions[0]?.path ??
      null;
    if (fallback) void this.selectSectionRepo(fallback);
  }

  /** Select a repo for the section: load its context + the current pane's list.
   *  The path is canonicalized to the registered project's own spelling, so every
   *  later comparison (`ensureSectionRepo`, the section's `selectedRepoId`) sees
   *  one spelling for one folder. */
  async selectSectionRepo(path: string): Promise<void> {
    this.sectionRepoPath = canonicalFor(path, app.repos.map((r) => r.path)) ?? path;
    await this.loadSectionContext();
  }

  /** A detail the section should open as soon as it takes over — set by an entry
   *  point outside the section (the right-panel tab's lists). The section owns
   *  its own detail state, so this is a one-shot request it consumes and clears;
   *  it is never a second source of truth for what's open. */
  pendingDetail = $state<PendingDetail | null>(null);

  /** Open the inline GitHub view on `section`, scoped to `repoPath` (a repo's
   *  main-worktree path), optionally straight into one item's detail. Every entry
   *  point goes through here — the project card's ⋯ menu, a worktree row's
   *  right-click menu, the right-panel lists — so adding one is adding a way to
   *  *reach* the view, never a second way to open it. Deliberately does not
   *  activate a workspace: activating one closes the view. */
  openSection(
    repoPath: string,
    section: GithubSection = "pulls",
    detail: PendingDetail | null = null,
  ): void {
    this.pendingDetail = detail;
    void this.selectSectionRepo(repoPath);
    app.openGithubInline(section);
  }

  /** Take the pending request (if any), clearing it so it fires exactly once. */
  takePendingDetail(): PendingDetail | null {
    const d = this.pendingDetail;
    if (d) this.pendingDetail = null;
    return d;
  }

  /** Load the selected repo's context (owner/repo + branch + PR). Guarded by a
   *  sequence token like `loadContext`: opening the section fires several loads
   *  in a row (the caller's, then the view's own effect), and without this an
   *  earlier repo's slower answer could land last and leave the header naming a
   *  project the lists aren't showing. */
  async loadSectionContext(): Promise<void> {
    const seq = ++this.#sectionSeq;
    const path = this.sectionRepoPath;
    if (!path || !this.available) {
      this.sectionContext = null;
      return;
    }
    this.sectionContextLoading = true;
    try {
      const ctx = await githubRepoContext(path);
      if (seq !== this.#sectionSeq) return; // a newer selection superseded us
      this.sectionContext = ctx;
    } catch {
      if (seq === this.#sectionSeq) this.sectionContext = null;
    } finally {
      if (seq === this.#sectionSeq) this.sectionContextLoading = false;
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
    const pathChanged = this.contextPath !== path;
    this.contextPath = path;
    if (pathChanged) this.context = null;
    if (!path || !this.available) {
      this.context = null;
      this.contextLoading = false;
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
      this.contextRevision += 1;
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
      this.refreshOtherWorktreeBadges();
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

  /** Keep the *other* worktrees' PR badges from going stale, without turning one
   *  poll into N network calls.
   *
   *  Two sources, both deliberately cheap:
   *  - **worktrees whose git status just changed** (drained from the projects
   *    store's sweep). New commits or a push is precisely when a branch gains or
   *    updates a PR, so this is the signal worth spending a `gh` call on.
   *  - **one rotating worktree per tick**, so a repo nobody touched still gets
   *    re-read eventually rather than never.
   *
   *  Capped per tick, because every context is a `gh` invocation against the API
   *  rate limit the status bar reports. */
  refreshOtherWorktreeBadges(): void {
    const active = app_activePath();
    const known = projects.allWorktreePaths().filter((p) => p !== active);
    if (known.length === 0) return;

    const changed = projects.takeChangedPaths().filter((p) => known.includes(p));
    const picks = changed.slice(0, BADGE_TICK_CAP);
    if (picks.length < BADGE_TICK_CAP) {
      // Round-robin over the rest, one per tick, skipping what we just picked.
      for (let i = 0; i < known.length && picks.length < BADGE_TICK_CAP; i++) {
        const candidate = known[this.#badgeCursor++ % known.length];
        if (!picks.includes(candidate)) picks.push(candidate);
      }
    }
    for (const path of picks) void this.loadContextFor(path);
  }

  /** Load one worktree's context into the per-path cache only — used for the
   *  sidebar badges of worktrees that are not the active one, so it never
   *  disturbs `context` (which the right panel reads). */
  async loadContextFor(path: string): Promise<void> {
    if (!this.available) return;
    try {
      const ctx = await githubRepoContext(path);
      if (!sameJson(ctx, this.contextByPath[path])) {
        this.contextByPath = { ...this.contextByPath, [path]: ctx };
      }
    } catch {
      /* leave the cached value */
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
