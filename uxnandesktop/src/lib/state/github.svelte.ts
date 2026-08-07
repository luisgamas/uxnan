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
import { resourceMode } from "./resourceMode.svelte";
import { effectiveGithubPollSeconds } from "$lib/resources/policy";
import { samePath, canonicalFor } from "$lib/pathid";
import { BADGE_TICK_CAP, pickBadgeTargets, resolveContext } from "$lib/githubRefresh";

/** Ceiling on the one-shot cold-start badge fill, so a user with dozens of
 *  worktrees doesn't meet a wall of `gh` spawns at launch. Scaled by the resource
 *  profile's GitHub factor (Efficient trades badge freshness for quiet); whatever
 *  the fill doesn't reach is picked up by the ordinary poll. */
const PRIME_MAX_PATHS = 24;

/** A "create pull request" form the user has open but not submitted.
 *
 *  It lives here rather than inside the form component so that nothing which
 *  remounts the panel — a background poll, a right-panel tab switch, closing the
 *  panel, stepping to another worktree and back — can throw away what they typed.
 *  A background refresh may add information; it may never destroy the user's. */
export interface PrDraft {
  title: string;
  body: string;
  base: string;
  head: string;
  draft: boolean;
}

/** A freshly-opened form: open, but nothing filled in yet. */
export function emptyPrDraft(): PrDraft {
  return { title: "", body: "", base: "", head: "", draft: false };
}

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

  /** Unsubmitted create-PR forms, keyed by the form's owner. Presence is also
   *  what keeps a form *open* across a remount — see `prDraft`. */
  prDrafts = $state<Record<string, PrDraft>>({});

  /** Monotonic token so a slow response for an old worktree can't clobber a newer
   *  one (worktree switches are frequent). */
  #ctxSeq = 0;
  /** Same guard for the *section's* context (the two are independent loads). */
  #sectionSeq = 0;
  /** Round-robin cursor over the non-active worktrees whose badges we refresh. */
  #badgeCursor = 0;
  /** Signalled paths a capped tick couldn't read yet (carried, not dropped). */
  #badgeBacklog: string[] = [];
  /** Consecutive `null` context reads per path — a transient miss must not blank
   *  a panel the user is looking at (see `resolveContext`). */
  #ctxMisses: Record<string, number> = {};
  /** Single-flight guard for the cold-start badge fill. */
  #priming = false;
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

  // --- Create-PR drafts ------------------------------------------------------
  // Keyed by the form's owner, not by path alone (`worktree:<path>` for the
  // right-panel tab, `section:<path>` for the section's own form): the two forms
  // can be open on the same repo at once and mean different things — the panel's
  // head is pinned to the worktree's branch, the section's is a choice.

  /** The open create-PR form for a key, or `null` when none is open. The views
   *  derive "is the form showing?" from this, so the form survives every remount
   *  instead of being reset by one. */
  prDraft(key: string | null | undefined): PrDraft | null {
    if (!key) return null;
    return this.prDrafts[key] ?? null;
  }

  /** Open a create-PR form (idempotent: re-opening keeps a draft that is already
   *  there instead of wiping it). `seed` fills a *new* draft only. */
  startPrDraft(key: string, seed: Partial<PrDraft> = {}): void {
    if (this.prDrafts[key]) return;
    this.prDrafts = { ...this.prDrafts, [key]: { ...emptyPrDraft(), ...seed } };
  }

  /** Merge a field change from the open form. */
  updatePrDraft(key: string, patch: Partial<PrDraft>): void {
    const current = this.prDrafts[key] ?? emptyPrDraft();
    const next = { ...current, ...patch };
    if (this.prDrafts[key] && sameJson(next, current)) return;
    this.prDrafts = { ...this.prDrafts, [key]: next };
  }

  /** Drop the draft — the user cancelled, or the PR was created. Those are the
   *  ONLY two ways a draft disappears; no refresh path may call this. */
  discardPrDraft(key: string): void {
    if (!(key in this.prDrafts)) return;
    const { [key]: _dropped, ...rest } = this.prDrafts;
    this.prDrafts = rest;
  }

  /** Refresh sign-in status. Best-effort; leaves the last value on failure. Only
   *  reassigns when the value actually changed, to avoid needless re-renders.
   *
   *  Signing in is also when the badges become readable for the first time, so a
   *  false → true flip primes them instead of waiting out a whole poll interval
   *  (at launch this read is what resolves *after* polling arms). */
  async refreshStatus(): Promise<void> {
    const wasAvailable = this.available;
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
    if (!wasAvailable && this.available) void this.prime();
  }

  /** Load the GitHub context for a worktree path. Clears when it isn't a GitHub
   *  repo, when no path is active, or when not signed in.
   *
   *  A `null` answer over a context we already hold is treated as a **miss**, not
   *  as "this stopped being a GitHub repo": `github_repo_context` answers
   *  `Option<RepoContext>`, so a git lock, a slow `gh` spawn or a dropped network
   *  is indistinguishable from the real thing — and taking a single one at face
   *  value tore the whole panel down mid-poll (an open create-PR form with it).
   *  A path that never had a context still answers immediately, so a genuinely
   *  non-GitHub worktree says so on arrival. See `resolveContext`. */
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
      const read = await githubRepoContext(path);
      if (seq !== this.#ctxSeq) return; // a newer request superseded us
      const { context: ctx, misses } = resolveContext({
        next: read,
        previous: this.context,
        misses: this.#ctxMisses[path] ?? 0,
      });
      this.#ctxMisses[path] = misses;
      // Only reassign when the value changed, so a steady poll doesn't churn the
      // sidebar badges / the panel (which read these).
      if (!sameJson(ctx, this.context)) this.context = ctx;
      if (!sameJson(ctx, this.contextByPath[path])) {
        this.contextByPath = { ...this.contextByPath, [path]: ctx };
      }
      // Push the PR verdict down to the worktree store, which uses it to decide
      // whether a space is finished. Pushed, not pulled: this module already
      // imports `projects`, so reading back the other way would close a cycle.
      projects.notePr(
        path,
        ctx?.pr
          ? { state: ctx.pr.state, isDraft: ctx.pr.isDraft, checks: ctx.pr.checks }
          : null,
      );
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
   *  cleanup. Safe to call repeatedly (restarts the timer).
   *
   *  The user's interval is scaled by the resource-mode policy (1× on
   *  Balanced, relaxed on Efficient, tighter — floored — on Performance);
   *  `0` stays manual-only whatever the profile. The caller's effect also
   *  depends on the policy, so a profile switch restarts the timer. */
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
    const seconds = effectiveGithubPollSeconds(
      resourceMode.policy,
      Math.max(0, app.settings.github?.pollSeconds ?? 45),
    );
    if (seconds > 0) {
      this.#timer = setInterval(tick, seconds * 1000);
      // `setInterval` fires *after* the interval, so everything the tick owns —
      // the rate-limit gauge, the unread count, every non-active worktree's PR
      // badge — used to stay blank for a full poll interval after launch, and
      // then trickle in two badges at a time. Fill what is empty now instead.
      void this.prime();
    }
    return () => this.stopPolling();
  }

  /** One-shot cold-start fill: read everything the poll would otherwise leave
   *  empty until its first tick, prioritising worktrees that show no badge at all.
   *
   *  Bounded on purpose — batches of `BADGE_TICK_CAP`, awaited one after another,
   *  so this is never more concurrent `gh` processes than a normal tick, and
   *  capped in total by `PRIME_MAX_PATHS` scaled by the resource profile. It is
   *  single-flight and stops the moment polling stops or sign-in goes away.
   *  Manual-only polling (interval `0`) opts out of this too: it is the same
   *  automatic reading the user switched off. */
  async prime(): Promise<void> {
    if (this.#priming || !this.available || !this.#timer) return;
    this.#priming = true;
    try {
      void this.refreshRateLimit();
      if (app.settings.github?.notificationsEnabled) void this.refreshNotifications();
      const factor = Math.max(0.1, resourceMode.policy.capabilities.githubPollFactor);
      const budget = Math.max(BADGE_TICK_CAP, Math.round(PRIME_MAX_PATHS / factor));
      const active = app_activePath();
      const missing = projects
        .allWorktreePaths()
        .filter((p) => p !== active && !(p in this.contextByPath))
        .slice(0, budget);
      for (let i = 0; i < missing.length; i += BADGE_TICK_CAP) {
        if (!this.#timer || !this.available) return;
        await Promise.all(
          missing.slice(i, i + BADGE_TICK_CAP).map((p) => this.loadContextFor(p)),
        );
      }
    } finally {
      this.#priming = false;
    }
  }

  stopPolling(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Keep the *other* worktrees' PR badges honest, without turning one poll into
   *  N network calls. The priority order lives in `pickBadgeTargets`: worktrees
   *  showing no badge at all first, then the ones whose git status just changed
   *  (new commits or a push is exactly when a branch gains or updates a PR), then
   *  a rotation so a repo nobody touched is still re-read eventually.
   *
   *  Capped per tick, because every context is a `gh` invocation against the API
   *  rate limit the status bar reports — and a signalled path that doesn't fit is
   *  carried to the next tick rather than dropped (the projects store hands each
   *  one over exactly once). */
  refreshOtherWorktreeBadges(): void {
    const tick = pickBadgeTargets({
      known: projects.allWorktreePaths(),
      active: app_activePath(),
      changed: [...this.#badgeBacklog, ...projects.takeChangedPaths()],
      primed: Object.keys(this.contextByPath),
      cursor: this.#badgeCursor,
      cap: BADGE_TICK_CAP,
    });
    this.#badgeCursor = tick.cursor;
    this.#badgeBacklog = tick.pending;
    for (const path of tick.picks) void this.loadContextFor(path);
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
      // Push the PR verdict down to the worktree store, which uses it to decide
      // whether a space is finished. Pushed, not pulled: this module already
      // imports `projects`, so reading back the other way would close a cycle.
      projects.notePr(
        path,
        ctx?.pr
          ? { state: ctx.pr.state, isDraft: ctx.pr.isDraft, checks: ctx.pr.checks }
          : null,
      );
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
