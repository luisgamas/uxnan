// Projects & worktrees state for the left panel (Svelte 5 runes).
//
// `app.repos` stays the canonical, backend-hydrated repo list; this store owns
// the sidebar-specific concerns layered on top: the per-repo worktree lists
// (loaded on demand and shown in a single global "Worktrees" section), the
// shared search query, the collapse state of the two sections, and the
// currently-active worktree. All git mutations go through `$lib/api`.

import {
  branchIntegrated,
  branchList,
  fsPathExists,
  githubIssueDevelop,
  githubPrCheckout,
  ptyWrite,
  repoAdd,
  repoRemove,
  repoReorder as apiRepoReorder,
  repoSetBranchIcon,
  repoSetWorktreeRoot,
  reposMissing,
  repoUpdate,
  setWorktreeOrder as apiSetWorktreeOrder,
  worktreeCreate,
  worktreeList,
  worktreeRemove,
  sshGitStatus,
  worktreeStatus,
} from "$lib/api";
import type {
  AgentProfile,
  BranchCleanup,
  BranchList,
  QuickCommand,
  RepoData,
  SidebarGroupBy,
  SortMode,
  WorktreeEntry,
  WorktreeStatus,
} from "$lib/types";
import { app } from "$lib/state/app.svelte";
import {
  canonicalFor,
  keyTarget,
  parseWorkspaceKey,
  reconcilePlan,
  samePath,
  sameWorkspace,
  workspaceKey,
} from "$lib/pathid";
import {
  expectation,
  isLocalTarget,
  LOCAL_TARGET,
  sshHostId,
  targetOf,
  type TargetId,
} from "$lib/target";
import { registerFlush } from "$lib/state/flushRegistry";
import { registerStatusSweep, shouldSweep } from "$lib/state/statusSweepRegistry";
import { terminals, GLOBAL_WORKSPACE } from "$lib/state/terminals.svelte";
import {
  resolveCommandCwd,
  substituteTokens,
  type CommandContext,
} from "$lib/quickCommands";
import { unread } from "$lib/state/unread.svelte";
import { agentStatus } from "$lib/state/agentStatus.svelte";
import { resolveAgentDisplay } from "$lib/state/agentDisplay";
import {
  applyManualOrder,
  buildStatusGroups,
  mostUrgentStatus,
  partitionPinned,
  sortItems,
  type SortMeta,
  type StatusLane,
} from "$lib/sidebar-sort";
import {
  classifyCompletion,
  isClosable,
  shouldCheckIntegration,
  type CompletionInputs,
  type CompletionState,
} from "$lib/worktree-completion";
import type { RemovalInputs } from "$lib/worktree-removal";
import { planBatchClose } from "$lib/worktree-batch-close";
import { buildReviewGroups, type ReviewGroup, type ReviewPr } from "$lib/sidebar-review";
import { resourceMode } from "$lib/state/resourceMode.svelte";
import { toast, toastError } from "$lib/toast";
import { i18n } from "$lib/i18n";

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

// The background sweep's pacing (how often every worktree's git status is
// re-read) and the worktree-list reconcile's pacing both come from the resource
// mode policy (`resourceMode.policy.capabilities` — 15 s / every driver tick on
// Balanced, relaxed on Efficient, tighter on Performance). Forced refreshes
// (focus, agent activity, our own git actions, the freshness hint) always run.

const baseName = (p: string) =>
  p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

/** A worktree flattened with its owning repo, for the global worktrees list. */
export interface WorktreeRow extends WorktreeEntry {
  repoId: string;
  repoName: string;
}

class ProjectsStore {
  /** Shared search query (filters projects and their worktrees). */
  query = $state("");

  /** Worktrees per repo id, loaded on demand. */
  worktreesByRepo = $state<Record<string, WorktreeEntry[]>>({});
  /** Working-tree status per worktree path (dirty/ahead/behind), best-effort. */
  statusByPath = $state<Record<string, WorktreeStatus>>({});
  /** Worktrees whose status changed since the GitHub poll last drained this. */
  changedPaths = $state<string[]>([]);
  /** Active worktree, keyed by its path (WorktreeEntry has no stable id). */
  activeWorktreePath = $state<string | null>(null);

  /** Last error from a project/worktree action, surfaced in the panel. */
  error = $state<string | null>(null);
  /** Whether the quick worktree-switch palette is open. */
  paletteOpen = $state(false);
  /** Whether the "add project" directory picker is open. Lives here (not in a
   *  component) so a global keyboard shortcut can open it even when the left
   *  sidebar is collapsed — the picker is mounted once at the page root. */
  pickerOpen = $state(false);
  /** Whether the "new worktree" dialog is open. Lives here (not in a component)
   *  so a global keyboard shortcut and the empty-state button can both open it;
   *  the dialog is mounted once at the page root, bound to [`activeRepo`]. */
  newWorktreeOpen = $state(false);

  /** The repo the active workspace belongs to (its main repo, or the repo a
   *  worktree branches from), or null for the Global space / an unknown key.
   *  Drives the "new worktree" affordances, which only apply inside a repo. */
  get activeRepo(): RepoData | null {
    const key = terminals.activeWorkspace;
    if (key === GLOBAL_WORKSPACE) return null;
    // Compared as workspace keys, not as paths: the same folder name on two
    // machines is two projects, and matching on the path alone would hand back
    // whichever one happened to be registered first.
    const keyOf = (repo: RepoData, path: string) => workspaceKey(targetOf(repo.target), path);
    const main = app.repos.find((r) => sameWorkspace(keyOf(r, r.path), key));
    if (main) return main;
    for (const r of app.repos) {
      if (this.worktreesOf(r.id).some((w) => sameWorkspace(keyOf(r, w.path), key))) return r;
    }
    return null;
  }

  /** The machine the active workspace is on.
   *
   *  **Derived, never stored.** The workspace key already carries its machine,
   *  and a second copy of that fact is a second thing to keep in sync — which is
   *  exactly how a panel ends up reading this PC's filesystem for a project on a
   *  host. The Global space names no machine, so there the selected project (if
   *  any) answers. */
  get activeWorktreeTarget(): TargetId {
    const key = terminals.activeWorkspace;
    if (key && key !== GLOBAL_WORKSPACE) return keyTarget(key);
    return this.activeWorktreePath ? this.targetForPath(this.activeWorktreePath) : LOCAL_TARGET;
  }

  /** The machine to describe `activeWorktreePath` on — the pair the review
   *  panels (Changes, History, the editor's gutter) read a **path** with.
   *
   *  Not the same question as [`activeWorktreeTarget`], and the difference is a
   *  bug we shipped: that one follows the focused terminal workspace, which is
   *  right for opening a terminal and wrong for describing a folder. Focus a
   *  terminal that lives on a host while a local project is selected and the two
   *  facts disagree — the panel then asked a host about a path on *this*
   *  machine. With the host down that showed "waiting for this host to connect"
   *  over a local project; with it up it would have been a review of the wrong
   *  machine, which is the failure that looks like success.
   *
   *  So: the workspace key answers only while it is about this very path (the
   *  one case the path alone cannot resolve — the same absolute path registered
   *  on two machines), and otherwise the path's own registration does. */
  get activeReviewTarget(): TargetId {
    const path = this.activeWorktreePath;
    if (!path) return LOCAL_TARGET;
    const key = terminals.activeWorkspace;
    if (key && key !== GLOBAL_WORKSPACE) {
      const focused = parseWorkspaceKey(key);
      if (samePath(focused.path, path)) return focused.target;
    }
    return this.targetForPath(path);
  }

  /** Whether the active workspace lives on another machine. Anything that reads
   *  this machine's filesystem or runs git here must check it first. */
  get activeIsRemote(): boolean {
    return !isLocalTarget(this.activeWorktreeTarget);
  }

  /** The active worktree path **only when it is on this machine** — what the
   *  local file watcher, git and GitHub layers are allowed to act on. A remote
   *  workspace resolves to null so those layers idle instead of reading a
   *  same-named folder here (`architecture/02g-remote-hosts.md` §6). */
  get activeLocalPath(): string | null {
    return this.activeIsRemote ? null : this.activeWorktreePath;
  }

  /** The active repo only when it is a real git repository — worktrees need git,
   *  so non-git project folders (and the Global space) resolve to null. Drives
   *  every "new worktree" affordance's enabled state. */
  get activeGitRepo(): RepoData | null {
    const r = this.activeRepo;
    return r && r.isGit !== false ? r : null;
  }

  /** Open the "new worktree" dialog for the active repo. A no-op outside a git
   *  repo (Global space / a non-git folder / nothing selected), so a shortcut
   *  does nothing rather than prompting with no repo to branch from. */
  requestNewWorktree(): void {
    if (this.activeGitRepo) this.newWorktreeOpen = true;
  }

  /** Projects visible for the search query: those whose name/path matches OR
   *  that have a matching worktree. */
  filteredRepos = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    if (!q) return app.repos;
    return app.repos.filter((r) => {
      if (r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
        return true;
      return this.worktreesOf(r.id).some(
        (w) =>
          (w.branch ?? "").toLowerCase().includes(q) ||
          w.path.toLowerCase().includes(q),
      );
    });
  });

  /** A repo's worktrees (empty until loaded). */
  worktreesOf(repoId: string): WorktreeEntry[] {
    return this.worktreesByRepo[repoId] ?? [];
  }

  /** Every known worktree flattened with its repo, for the quick-switch palette. */
  allWorktrees(): {
    repoId: string;
    repoName: string;
    branch: string;
    path: string;
    isMain: boolean;
  }[] {
    const out: {
      repoId: string;
      repoName: string;
      branch: string;
      path: string;
      isMain: boolean;
    }[] = [];
    for (const r of app.repos) {
      for (const w of this.worktreesOf(r.id)) {
        out.push({
          repoId: r.id,
          repoName: r.name,
          branch: w.branch ?? "",
          path: w.path,
          isMain: w.isMain,
        });
      }
    }
    return out;
  }

  /** A repo's primary (main) worktree — the project's own context. */
  mainWorktree(repoId: string): WorktreeEntry | undefined {
    const list = this.worktreesOf(repoId);
    const main = list.find((w) => w.isMain);
    if (main) return main;
    const repo = app.repos.find((r) => r.id === repoId);
    return repo ? list.find((w) => w.path === repo.path) : undefined;
  }

  /** A repo's non-main worktrees (shown as sub-rows under the project). */
  childWorktrees(repoId: string): WorktreeEntry[] {
    return this.worktreesOf(repoId).filter((w) => !w.isMain);
  }

  /** Non-main worktrees to show for a project under the current query. */
  visibleChildWorktrees(repoId: string): WorktreeEntry[] {
    const children = this.childWorktrees(repoId);
    const q = this.query.trim().toLowerCase();
    if (!q) return children;
    const repo = app.repos.find((r) => r.id === repoId);
    const projectMatches =
      !!repo &&
      (repo.name.toLowerCase().includes(q) ||
        repo.path.toLowerCase().includes(q));
    if (projectMatches) return children;
    return children.filter(
      (w) =>
        (w.branch ?? "").toLowerCase().includes(q) ||
        w.path.toLowerCase().includes(q),
    );
  }

  /** Total worktrees known for a repo (for the project card badge). */
  worktreeCount(repoId: string): number {
    return this.worktreesByRepo[repoId]?.length ?? 0;
  }

  /** A registered repo's folder path by id (used e.g. for a short, relative-path
   *  worktree label in the flattened status view). */
  repoPath(repoId: string): string | undefined {
    return app.repos.find((r) => r.id === repoId)?.path;
  }

  // --- Sorting (left sidebar) ----------------------------------------------

  /** Current sort mode for the project cards (persisted; defaults to manual). */
  get projectSort(): SortMode {
    return app.settings.projectSort ?? "manual";
  }

  /** Current sort mode for the worktree rows within each project (persisted). */
  get worktreeSort(): SortMode {
    return app.settings.worktreeSort ?? "manual";
  }

  /** Change the project-card sort mode and persist it. */
  setProjectSort(mode: SortMode): void {
    app.settings.projectSort = mode;
    void app.persistSettings();
  }

  /** Change the worktree-row sort mode and persist it. */
  setWorktreeSort(mode: SortMode): void {
    app.settings.worktreeSort = mode;
    void app.persistSettings();
  }

  /** Current sidebar grouping mode (persisted; defaults to the project tree). */
  get groupBy(): SidebarGroupBy {
    return app.settings.sidebarGroupBy ?? "none";
  }

  /** Change the sidebar grouping mode and persist it. */
  setGroupBy(mode: SidebarGroupBy): void {
    app.settings.sidebarGroupBy = mode;
    void app.persistSettings();
  }

  /** Whether an attention lane is collapsed in the status view (persisted). */
  isLaneCollapsed(lane: number): boolean {
    return app.settings.sidebarCollapsedLanes?.includes(lane) ?? false;
  }

  /** Toggle a status-view lane's collapse state and persist it. */
  toggleLane(lane: number): void {
    const cur = app.settings.sidebarCollapsedLanes ?? [];
    app.settings.sidebarCollapsedLanes = cur.includes(lane)
      ? cur.filter((x) => x !== lane)
      : [...cur, lane];
    void app.persistSettings();
  }

  /** Whether a review lane is collapsed (persisted, like the attention lanes). */
  isReviewLaneCollapsed(group: ReviewGroup): boolean {
    return app.settings.sidebarCollapsedReviewLanes?.includes(group) ?? false;
  }

  /** Toggle a review lane's collapse state and persist it. */
  toggleReviewLane(group: ReviewGroup): void {
    const cur = app.settings.sidebarCollapsedReviewLanes ?? [];
    app.settings.sidebarCollapsedReviewLanes = cur.includes(group)
      ? cur.filter((g) => g !== group)
      : [...cur, group];
    void app.persistSettings();
  }

  // --- Expansion (left sidebar) --------------------------------------------
  //
  // Both of these are persisted. They used to be component-local `$state`, which
  // meant every launch reopened the panel with all projects collapsed — the app
  // looked empty even with a dozen worktrees and several agents running, and the
  // agent lists you had closed came back open. The sidebar now returns exactly
  // as you left it.

  /** Whether a project card is expanded in the tree view (persisted). */
  isProjectExpanded(repoId: string): boolean {
    return app.settings.sidebarExpandedProjects?.includes(repoId) ?? false;
  }

  /** Set a project card's expansion and persist it. A setter (not a toggle) on
   *  purpose: a live search force-expands every matching card, so the caller
   *  passes the negation of the *effective* state — a blind toggle would store
   *  "expanded" for a card that is only open because of the query. */
  setProjectExpanded(repoId: string, expanded: boolean): void {
    const cur = app.settings.sidebarExpandedProjects ?? [];
    if (cur.includes(repoId) === expanded) return;
    app.settings.sidebarExpandedProjects = expanded
      ? [...cur, repoId]
      : cur.filter((x) => x !== repoId);
    void app.persistSettings();
  }

  /** Whether a workspace's agent list is collapsed (persisted; open by default). */
  isAgentSpaceCollapsed(path: string): boolean {
    return app.settings.sidebarCollapsedAgentSpaces?.some((p) => samePath(p, path)) ?? false;
  }

  /** Toggle a workspace's agent-list collapse and persist it. */
  toggleAgentSpace(path: string): void {
    const cur = app.settings.sidebarCollapsedAgentSpaces ?? [];
    app.settings.sidebarCollapsedAgentSpaces = this.isAgentSpaceCollapsed(path)
      ? cur.filter((p) => !samePath(p, path))
      : [...cur, path];
    void app.persistSettings();
  }

  /** Every visible worktree (each project's main + its children) flattened into
   *  attention lanes for the "group by status" view. Empty lanes are omitted;
   *  within a lane, pinned worktrees float to the top, then the freshest/most-
   *  recent. Each row keeps its `repoId`/`repoName` so the view can label it. */
  statusGroups(): StatusLane<WorktreeRow>[] {
    const all: WorktreeRow[] = [];
    for (const repo of this.filteredRepos) {
      const main = this.mainWorktree(repo.id);
      if (main) {
        all.push({ ...main, isMain: true, repoId: repo.id, repoName: repo.name });
      }
      for (const w of this.visibleChildWorktrees(repo.id)) {
        all.push({ ...w, repoId: repo.id, repoName: repo.name });
      }
    }
    return buildStatusGroups(
      all,
      (w) => this.worktreeSortMeta(w),
      (w) => isClosable(this.completion(w)),
    ).map((lane) => ({
      attention: lane.attention,
      items: partitionPinned(lane.items, (w) => this.isWorktreePinned(w.path)),
    }));
  }

  /** How many visible worktrees have an agent asking for *you* right now — the
   *  `waiting`/`blocked` pair that `attentionClass` calls class 1. Drives the
   *  sidebar header's attention pill: the one number worth surfacing above the
   *  tree, so a permission prompt inside a collapsed project can't sit unseen.
   *  One pass over the visible worktrees, no lane building. */
  get needsYouCount(): number {
    let n = 0;
    for (const repo of this.filteredRepos) {
      const main = this.mainWorktree(repo.id);
      const paths = main ? [main.path] : [];
      for (const w of this.visibleChildWorktrees(repo.id)) paths.push(w.path);
      for (const p of paths) {
        const s = mostUrgentStatus(
          terminals.agentTabs(p).map((t) => resolveAgentDisplay(t)?.status ?? null),
        );
        if (s === "waiting" || s === "blocked") n += 1;
      }
    }
    return n;
  }

  /** Jump to the "needs you" lane: switch to the status view and make sure that
   *  lane is open, so the pill lands on the rows it counted. */
  revealNeedsYou(): void {
    if (this.isLaneCollapsed(1)) this.toggleLane(1);
    this.setGroupBy("status");
  }

  /** Every visible worktree grouped by where it sits in the review process
   *  (`groupBy: "review"`). Reuses the same flattened row set as the attention
   *  view, so the two groupings can never disagree about what exists. */
  reviewGroups(): { group: ReviewGroup; items: WorktreeRow[] }[] {
    const all: WorktreeRow[] = [];
    for (const repo of this.filteredRepos) {
      const main = this.mainWorktree(repo.id);
      if (main) {
        all.push({ ...main, isMain: true, repoId: repo.id, repoName: repo.name });
      }
      for (const w of this.visibleChildWorktrees(repo.id)) {
        all.push({ ...w, repoId: repo.id, repoName: repo.name });
      }
    }
    return buildReviewGroups(all, (w) => this.prFor(w.path)).map((lane) => ({
      group: lane.group,
      items: partitionPinned(lane.items, (w) => this.isWorktreePinned(w.path)),
    }));
  }

  /** Sort metadata for a workspace path — the agent status/unread/recency the
   *  comparators read, aggregated across the agents running in it. */
  private workspaceMeta(path: string, name: string): SortMeta {
    const tabs = terminals.agentTabs(path);
    const status = mostUrgentStatus(
      tabs.map((t) => resolveAgentDisplay(t)?.status ?? null),
    );
    let activityAt = 0;
    for (const t of tabs) {
      const hook = agentStatus.get(t.id);
      if (hook?.lastUpdate) activityAt = Math.max(activityAt, hook.lastUpdate);
    }
    return {
      name,
      lastActive: app.settings.workspaceLastActive?.[path] ?? 0,
      status,
      unread: unread.has(path),
      activityAt,
    };
  }

  /** Sort metadata for a single worktree row. */
  private worktreeSortMeta(w: WorktreeEntry): SortMeta {
    return this.workspaceMeta(w.path, w.branch ?? baseName(w.path));
  }

  /** Sort metadata for a project card — the most-urgent/most-recent aggregate
   *  across its main worktree and children, so a project bubbles up when any of
   *  its worktrees needs attention. */
  private repoSortMeta(repo: RepoData): SortMeta {
    const main = this.mainWorktree(repo.id);
    const metas = [this.workspaceMeta(main?.path ?? repo.path, repo.name)];
    for (const w of this.childWorktrees(repo.id)) {
      metas.push(this.workspaceMeta(w.path, w.branch ?? baseName(w.path)));
    }
    return {
      name: repo.name,
      lastActive: Math.max(0, ...metas.map((m) => m.lastActive)),
      status: mostUrgentStatus(metas.map((m) => m.status)),
      unread: metas.some((m) => m.unread),
      activityAt: Math.max(0, ...metas.map((m) => m.activityAt)),
    };
  }

  /** Whether a project is pinned (shown first regardless of sort). */
  isProjectPinned(id: string): boolean {
    return app.settings.pinnedProjects?.includes(id) ?? false;
  }

  /** Whether a worktree (by path) is pinned. */
  isWorktreePinned(path: string): boolean {
    return app.settings.pinnedWorktrees?.includes(path) ?? false;
  }

  /** Toggle a project's pinned state and persist. */
  toggleProjectPin(id: string): void {
    const cur = app.settings.pinnedProjects ?? [];
    app.settings.pinnedProjects = cur.includes(id)
      ? cur.filter((x) => x !== id)
      : [...cur, id];
    void app.persistSettings();
  }

  /** Toggle a worktree's pinned state and persist. */
  toggleWorktreePin(path: string): void {
    const cur = app.settings.pinnedWorktrees ?? [];
    app.settings.pinnedWorktrees = cur.includes(path)
      ? cur.filter((x) => x !== path)
      : [...cur, path];
    void app.persistSettings();
  }

  /** The project cards in their effective order: pinned first, then the active
   *  sort ("manual" keeps the persisted `app.repos` order; the rest compute). */
  sortedRepos(): RepoData[] {
    const sorted = sortItems(this.filteredRepos, this.projectSort, (r) =>
      this.repoSortMeta(r),
    );
    return partitionPinned(sorted, (r) => this.isProjectPinned(r.id));
  }

  /** A project's child worktrees in their effective order: pinned first, then the
   *  active sort ("manual" applies the persisted `worktreeOrder`; the rest
   *  compute). The card renders the main worktree ahead of all of these. */
  orderedChildWorktrees(repoId: string): WorktreeEntry[] {
    const children = this.visibleChildWorktrees(repoId);
    const ordered =
      this.worktreeSort === "manual"
        ? applyManualOrder(
            children,
            app.repos.find((r) => r.id === repoId)?.worktreeOrder ?? [],
            (w) => w.path,
          )
        : sortItems(children, this.worktreeSort, (w) => this.worktreeSortMeta(w));
    return partitionPinned(ordered, (w) => this.isWorktreePinned(w.path));
  }

  /** Apply a manual reorder of the project cards: reorder `app.repos` optimistically
   *  and persist it, then switch the mode to manual (a drag is an explicit request
   *  for the user's own order). Unlisted repos keep their place after the listed. */
  async reorderProjects(orderedIds: string[]): Promise<void> {
    const rank = new Map(orderedIds.map((id, i) => [id, i] as const));
    app.repos = [...app.repos].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    this.setProjectSort("manual");
    try {
      await apiRepoReorder(orderedIds);
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    }
  }

  /** Apply a manual reorder of a project's child worktrees: persist the path order,
   *  reconcile the repo, and switch the worktree sort to manual. */
  async reorderWorktrees(repoId: string, orderedPaths: string[]): Promise<void> {
    this.setWorktreeSort("manual");
    const i = app.repos.findIndex((r) => r.id === repoId);
    if (i !== -1) app.repos[i] = { ...app.repos[i], worktreeOrder: orderedPaths };
    try {
      const updated = await apiSetWorktreeOrder(repoId, orderedPaths);
      const j = app.repos.findIndex((r) => r.id === repoId);
      if (j !== -1) app.repos[j] = updated;
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    }
  }

  /** Record *now* as a workspace's last-active time (feeds the "recent" sort),
   *  persisted with a short debounce so rapid switching doesn't hammer the disk. */
  private stampActive(path: string): void {
    app.settings.workspaceLastActive = {
      ...(app.settings.workspaceLastActive ?? {}),
      [path]: Date.now(),
    };
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void app.persistSettings();
    }, 1500);
  }
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  /** Force the pending (debounced) workspace-recency stamp immediately — called
   *  on window close so a just-switched workspace's last-active time isn't lost.
   *  A no-op when no stamp is pending. */
  private async flushLastActive(): Promise<void> {
    if (this.persistTimer === null) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
    await app.persistSettings();
  }
  private worktreeRefreshInFlight = false;
  /** When the last worktree-list reconcile pass started (policy pacing). */
  #lastReconcile = 0;

  /** Projects whose folder is not on disk right now, by id.
   *
   *  NOT proof anything was deleted — an unmounted drive, an offline share and
   *  a cloud placeholder all look like this. So the app marks them and stops
   *  spending work on them (polling git and `gh` at a path that is not there
   *  produces nothing but errors, forever) and never removes them itself. */
  missingRepoIds = $state<Set<string>>(new Set());

  /** Whether a project's folder is currently missing. */
  isMissing(repoId: string): boolean {
    return this.missingRepoIds.has(repoId);
  }

  /** Re-read which projects are missing. Cheap: one directory check each. */
  async refreshMissing(): Promise<void> {
    try {
      this.missingRepoIds = new Set(await reposMissing());
    } catch {
      // Unknown is treated as present: marking a project missing on a failed
      // check would hide a working project behind a warning.
    }
  }
  /** Single-flight + rate-limit state for the all-worktree status sweep. */
  #sweepInFlight = false;
  #lastSweep = 0;
  private initPromise: Promise<void> | null = null;

  /** Load every repo's worktrees. Called from the boot sequence and from the
   *  sidebar's ready-effect; the promise is shared so whoever awaits it gets
   *  the *completed* first load, never a short-circuited duplicate call. */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      // Force the pending workspace-recency stamp on window close (idempotent id).
      registerFlush("workspace-last-active", () => this.flushLastActive());
      await Promise.all(app.repos.map((r) => this.loadWorktrees(r.id)));
    })();
    return this.initPromise;
  }

  /** One-shot boot pass linking the restored terminal layout back to the
   *  project/worktree world it belongs to (the persisted layout stores only
   *  workspace keys):
   *  - keys that name a known repo/worktree are re-spelled to the canonical
   *    (git-emitted) path, so exact-match lookups (`activeRepo`, badges,
   *    agent rows) can't miss over a separator/case difference;
   *  - the restored **active** workspace, when known, becomes the selected
   *    worktree through the same path a sidebar click takes — so the git
   *    panel, fs watcher, GitHub context and launch targeting all follow with
   *    zero clicks (previously the selection stayed empty until a click,
   *    leaving a live restored terminal driving a half-selected shell);
   *  - keys whose folder is gone from disk are dropped (their worktree was
   *    removed in an earlier session; stale entries used to pile up forever).
   *    A key whose folder still exists but is unregistered is kept untouched —
   *    real shells are never destroyed on a guess. */
  async reconcileRestoredWorkspaces(): Promise<void> {
    const known: string[] = [];
    // Worktree spellings first: they are what sidebar clicks use as keys.
    for (const r of app.repos)
      for (const w of this.worktreesOf(r.id)) known.push(this.workspaceFor(w.path, targetOf(r.target)));
    for (const r of app.repos) known.push(this.workspaceFor(r.path, targetOf(r.target)));

    const plan = reconcilePlan(terminals.workspaceKeys, known);
    for (const [oldKey, newKey] of plan.rekeys) terminals.rekeyWorkspace(oldKey, newKey);
    for (const key of plan.unknown) {
      // A workspace on a host cannot be checked against this filesystem — asking
      // would answer about a folder here — so it is kept. Its project is
      // registered or it is not; either way a live shell is never dropped on a
      // question this machine cannot answer.
      if (!isLocalTarget(keyTarget(key))) continue;
      // On an API failure err on the side of keeping the workspace.
      const exists = await fsPathExists(key).catch(() => true);
      if (!exists) terminals.dropWorkspace(key);
    }

    const active = terminals.activeWorkspace;
    if (active === GLOBAL_WORKSPACE) return;
    const canon = canonicalFor(active, known);
    if (canon !== undefined) {
      const { target, path } = parseWorkspaceKey(canon);
      this.setActiveWorktree(path, target);
    }
  }

  /**
   * Reconcile worktrees that may have been created outside the ADE (for example
   * by an agent CLI). The backend has no reliable cross-platform worktree
   * filesystem event, so the sidebar uses a small polling pass. Only changed
   * lists are assigned, which keeps the sort settle window and row rendering
   * stable while still making externally-created worktrees appear promptly.
   *
   * Paced by the resource mode: on Balanced/Performance the policy interval is
   * 0 (every driver tick — the pre-mode behavior); Efficient stretches it.
   * `force` (a manual "refresh now") always runs.
   */
  async refreshWorktrees(force = false): Promise<void> {
    if (this.worktreeRefreshInFlight) return;
    const proceed = shouldSweep({
      inFlight: false, // the in-flight guard above already covers overlap
      force,
      hidden: false, // structural changes matter even unfocused (agent CLIs)
      now: Date.now(),
      lastSweep: this.#lastReconcile,
      intervalMs: resourceMode.policy.capabilities.worktreeReconcileIntervalMs,
    });
    if (!proceed) return;
    this.#lastReconcile = Date.now();
    this.worktreeRefreshInFlight = true;
    try {
      await this.refreshMissing();
      await Promise.all(
        app.repos.map(async (repo) => {
          // A project whose folder is gone has nothing to reconcile, and asking
          // anyway is what turned one deleted folder into an endless stream of
          // failed git and `gh` spawns.
          if (this.isMissing(repo.id)) return;
          try {
            const list = await worktreeList(repo.id);
            const current = this.worktreesByRepo[repo.id] ?? [];
            const same =
              current.length === list.length &&
              current.every(
                (entry, index) =>
                  entry.path === list[index]?.path &&
                  entry.branch === list[index]?.branch &&
                  entry.isMain === list[index]?.isMain,
              );
            if (!same) {
              this.worktreesByRepo = { ...this.worktreesByRepo, [repo.id]: list };
              // Reads git on whichever machine the worktree is on (see
              // `refreshStatuses`), so a host's project gets real badges.
              await this.refreshStatuses(list.map((w) => w.path));
            }
          } catch {
            // A repository can briefly be unavailable while an agent creates a
            // worktree; the next polling pass will reconcile it.
          }
        }),
      );
    } finally {
      this.worktreeRefreshInFlight = false;
    }
  }

  async loadWorktrees(repoId: string, refreshStatus = true): Promise<void> {
    try {
      const list = await worktreeList(repoId);
      this.worktreesByRepo = { ...this.worktreesByRepo, [repoId]: list };
      if (refreshStatus) await this.refreshStatuses(list.map((w) => w.path));
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    }
  }

  /** Best-effort refresh of the git status badges for the given worktree paths.
   *  Returns the paths whose status actually changed, so callers can react to a
   *  real change (see `changedPaths`). */
  async refreshStatuses(paths: string[]): Promise<string[]> {
    const entries = await Promise.all(
      paths.map(async (path) => {
        try {
          // Whichever machine the worktree is on. Asking this one for a host's
          // path is how a sidebar badge ends up describing the wrong folder.
          const host = sshHostId(this.targetForPath(path));
          if (host) {
            const remote = await sshGitStatus(host, path);
            // "Not a repository / no git / unnamed shell" is not "clean": leave
            // the badges alone rather than showing zeroes that mean nothing.
            if (!remote.isRepo) return null;
            return [path, { dirty: remote.dirty, ahead: remote.ahead, behind: remote.behind }] as const;
          }
          return [path, await worktreeStatus(path)] as const;
        } catch {
          return null;
        }
      }),
    );
    const merged = { ...this.statusByPath };
    const changed: string[] = [];
    for (const entry of entries) {
      if (!entry) continue;
      const [path, next] = entry;
      const prev = merged[path];
      if (
        !prev ||
        prev.dirty !== next.dirty ||
        prev.ahead !== next.ahead ||
        prev.behind !== next.behind
      ) {
        changed.push(path);
      }
      merged[path] = next;
    }
    this.statusByPath = merged;
    if (changed.length) {
      // Announce it for the GitHub poll (a worktree that just gained commits or
      // got pushed is exactly when its PR badge is worth re-reading). Draining
      // this from `github` instead of calling it here keeps the store graph
      // one-way — `github` already imports `projects`, not the reverse.
      this.changedPaths = [...new Set([...this.changedPaths, ...changed])];
      // A worktree whose commits moved may have just landed (or stopped being
      // landed): drop the cached "is it integrated?" answer so the next sweep
      // re-asks instead of serving a verdict about an older commit.
      for (const path of changed) this.forgetIntegration(path);
    }
    return changed;
  }

  /** Every known worktree path across all projects (main + children). */
  allWorktreePaths(): string[] {
    const out: string[] = [];
    for (const repo of app.repos) {
      // Feeds the GitHub badge poll: a missing project must not be polled.
      if (this.isMissing(repo.id)) continue;
      const list = this.worktreesOf(repo.id);
      if (list.length) out.push(...list.map((w) => w.path));
      else if (repo.isGit !== false) out.push(repo.path);
    }
    return [...new Set(out)];
  }

  /** Refresh the badges of EVERY known worktree, not just the active one.
   *
   *  The card indicators used to be a lie for any worktree you weren't standing
   *  in: the 3 s backend watcher follows a single path (the active worktree) and
   *  the sidebar poll only re-read statuses when a worktree appeared or
   *  disappeared. An agent working from another folder — or from the parent repo
   *  — left its target worktree's card showing nothing until you clicked it.
   *
   *  Rate-limited to the resource-mode policy's sweep interval (15 s on
   *  Balanced), skipped while the window is hidden, and single-flight. `force`
   *  (agent activity, window focus, a git action of ours) runs it now instead
   *  of waiting for the interval. */
  async sweepStatuses(force = false): Promise<void> {
    const proceed = shouldSweep({
      inFlight: this.#sweepInFlight,
      force,
      hidden: typeof document !== "undefined" && document.hidden,
      now: Date.now(),
      lastSweep: this.#lastSweep,
      intervalMs: resourceMode.policy.capabilities.gitSweepIntervalMs,
    });
    if (!proceed) return;
    const paths = this.allWorktreePaths();
    if (paths.length === 0) return;
    this.#sweepInFlight = true;
    try {
      await this.refreshStatuses(paths);
      // Statuses first: the integration pass reads them to decide which
      // worktrees are quiet enough to be worth a git call at all.
      await this.#sweepIntegration();
      this.#lastSweep = Date.now();
    } finally {
      this.#sweepInFlight = false;
    }
  }

  /** Ask for a sweep at the next opportunity — used by the signals that mean
   *  "something just changed on disk": an agent reporting a state transition,
   *  the window regaining focus, and our own git actions. */
  requestStatusSweep(): void {
    void this.sweepStatuses(true);
  }

  // --- Completion ("is this space finished?") -------------------------------
  //
  // The verdict is composed in `completion()` from data that is already cached
  // (the PR, the working-tree status, the live agents) plus one bit that costs a
  // git call — whether the branch landed in the base. That bit is filled in
  // lazily, only for worktrees that already look quiet, so the panel never pays
  // for an answer it cannot use.

  /** `path` → whether its branch landed in the base. Absent = not asked yet. */
  #integrated = $state<Record<string, boolean>>({});
  /** Paths with an integration check in flight, so a sweep can't stack them. */
  #integrationInFlight = new Set<string>();
  /** `path` → the pull request the GitHub store discovered for it, narrowed to
   *  what the sidebar reads. Pushed in rather than read back: `github` already
   *  imports this module, so reading from here would close an import cycle. */
  #pr = $state<Record<string, ReviewPr | null>>({});

  /** Record a worktree's pull request (called by the GitHub store when it caches
   *  a context). `null` clears it — no PR, or none discoverable. */
  notePr(path: string, pr: ReviewPr | null): void {
    const prev = this.#pr[path] ?? null;
    if (prev?.state === pr?.state && prev?.isDraft === pr?.isDraft) return;
    this.#pr = { ...this.#pr, [path]: pr };
    // The PR just spoke, so any locally-inferred verdict is stale.
    this.forgetIntegration(path);
  }

  /** The cached pull request for a worktree path, for the review grouping. */
  prFor(path: string): ReviewPr | null {
    return this.#pr[path] ?? null;
  }

  /** The completion verdict for a worktree row. Pure read — safe from markup. */
  completion(row: { path: string; branch: string | null; isMain?: boolean }): CompletionState {
    return classifyCompletion(this.#completionInputs(row));
  }

  #completionInputs(row: {
    path: string;
    branch: string | null;
    isMain?: boolean;
  }): CompletionInputs {
    const pr = this.#pr[row.path] ?? null;
    return {
      pr: pr ? { state: pr.state } : null,
      status: this.status(row.path) ?? null,
      integrated: this.#integrated[row.path] ?? null,
      hasLiveAgent: terminals.agentTabs(row.path).some((t) => !t.exited),
      isMain: row.isMain === true,
    };
  }

  /** Fill in the integration bit for the worktrees where it can change the
   *  verdict. Called from the paced sweep, never from markup: it spawns git. */
  async #sweepIntegration(): Promise<void> {
    for (const repo of app.repos) {
      for (const w of this.worktreesOf(repo.id)) {
        if (w.isMain || !w.branch) continue;
        if (this.#integrationInFlight.has(w.path)) continue;
        if (!shouldCheckIntegration(this.#completionInputs(w))) continue;
        this.#integrationInFlight.add(w.path);
        try {
          this.#integrated[w.path] = await branchIntegrated(w.path, w.branch);
        } catch {
          // A repo we can't read is not "finished" — leave it unasked so a later
          // sweep retries instead of freezing a wrong verdict into the panel.
        } finally {
          this.#integrationInFlight.delete(w.path);
        }
      }
    }
  }

  /** Drop a cached integration verdict when the branch may have moved (a commit,
   *  a push, a status change), so it is re-asked rather than served stale. */
  forgetIntegration(path: string): void {
    delete this.#integrated[path];
  }

  // --- Notes ("why does this space exist?") --------------------------------

  /** This worktree's note, or "" when it has none. */
  note(path: string): string {
    return app.settings.worktreeNotes?.[path] ?? "";
  }

  /** Set (or, with empty text, clear) a worktree's note and persist it. The
   *  branch name only keeps a slug of what you typed — folded, truncated, cut to
   *  a word boundary — so the note is where the sentence itself survives. */
  setNote(path: string, note: string): void {
    const next = { ...(app.settings.worktreeNotes ?? {}) };
    const text = note.trim();
    if (text) next[path] = text;
    else delete next[path];
    app.settings.worktreeNotes = next;
    void app.persistSettings();
  }

  /** Forget a removed worktree's note, so the map doesn't accumulate paths that
   *  no longer exist. Called from the removal path. */
  dropNote(path: string): void {
    if (!app.settings.worktreeNotes?.[path]) return;
    this.setNote(path, "");
  }

  /** The removal inputs for a row — shared by the single dialog and the batch so
   *  neither can drift into judging a workspace differently from the other. */
  removalInputsFor(row: { path: string; branch: string | null; isMain?: boolean }): RemovalInputs {
    const status = this.status(row.path);
    return {
      completion: this.completion(row),
      dirty: status?.dirty ?? 0,
      ahead: status?.ahead ?? 0,
      liveAgents: terminals.agentTabs(row.path).filter((t) => !t.exited).length,
      hasBranch: !!row.branch,
    };
  }

  /** Close every workspace the batch deems safe, one at a time. Returns how many
   *  actually went, so the caller can report the real number rather than the
   *  number it hoped for. Sequential on purpose: each removal kills terminals and
   *  reloads its repo's worktree list, and running those concurrently raced. */
  async closeBatch(rows: WorktreeRow[]): Promise<number> {
    const plan = planBatchClose(rows.map((row) => ({ item: row, inputs: this.removalInputsFor(row) })));
    let closed = 0;
    for (const entry of plan.close) {
      const ok = await this.removeWorktree(entry.item, false, {
        deleteLocal: entry.deleteLocal,
        forceLocal: false,
        deleteRemote: false,
      });
      if (ok) closed += 1;
    }
    return closed;
  }

  /** Manual "refresh now" (the freshness hint's action): re-read the worktree
   *  lists AND every status badge immediately. A one-shot that bypasses the
   *  policy pacing without touching the selected profile. */
  refreshNow(): void {
    void this.refreshWorktrees(true);
    this.requestStatusSweep();
  }

  /** Take the paths whose status changed since the last drain (the GitHub poll
   *  consumes these to re-read just those worktrees' PR badges). */
  takeChangedPaths(): string[] {
    const out = this.changedPaths;
    if (out.length) this.changedPaths = [];
    return out;
  }

  /** Status badge data for a worktree path (undefined until loaded). */
  status(path: string): WorktreeStatus | undefined {
    return this.statusByPath[path];
  }

  /** Set a worktree's status badge directly. The git review panel calls this so
   *  the project card stays in sync with the live status (e.g. after a commit). */
  setStatus(path: string, status: WorktreeStatus): void {
    this.statusByPath = { ...this.statusByPath, [path]: status };
  }

  /** A repo's branches + resolved default base, for the new-worktree dialog. */
  branchInfo(repoId: string): Promise<BranchList> {
    return branchList(repoId);
  }

  /** Register a project folder by path (from the in-app directory picker). Any
   *  folder works — git or not; a non-git one simply has no worktrees. Returns
   *  false (with `error` set) when the path can't be registered. */
  async addProjectPath(path: string): Promise<boolean> {
    this.error = null;
    try {
      const repo = await repoAdd(path);
      if (!app.repos.find((r) => r.id === repo.id)) app.repos.push(repo);
      await this.loadWorktrees(repo.id);
      return true;
    } catch (e) {
      this.error = msg(e);
      return false;
    }
  }

  /** Update a project's display name and/or icon (card-only; never touches the
   *  folder). Reconciles the returned repo into `app.repos` so the sidebar and
   *  any open dialog re-render. Only the fields present in `changes` are applied. */
  async updateProject(
    id: string,
    changes: { name?: string; icon?: string | null },
  ): Promise<boolean> {
    this.error = null;
    try {
      const updated = await repoUpdate(id, changes);
      const i = app.repos.findIndex((r) => r.id === id);
      if (i !== -1) app.repos[i] = updated;
      return true;
    } catch (e) {
      this.error = msg(e);
      toastError(e);
      return false;
    }
  }

  /** Set (or clear with null) this project's own managed-worktree root, which
   *  overrides Settings → Git for this repository only. Reconciles the returned
   *  repo into `app.repos`. Rethrows, so the dialog can keep what was typed and
   *  show why an invalid path was refused. */
  async setWorktreeRoot(repoId: string, root: string | null): Promise<void> {
    const updated = await repoSetWorktreeRoot(repoId, root);
    const i = app.repos.findIndex((r) => r.id === repoId);
    if (i !== -1) app.repos[i] = updated;
  }

  /** Set (or clear with null) a per-branch icon, keyed by branch name (or the
   *  worktree path when detached). Reconciles the returned repo into `app.repos`. */
  async setBranchIcon(
    repoId: string,
    branchKey: string,
    icon: string | null,
  ): Promise<boolean> {
    this.error = null;
    try {
      const updated = await repoSetBranchIcon(repoId, branchKey, icon);
      const i = app.repos.findIndex((r) => r.id === repoId);
      if (i !== -1) app.repos[i] = updated;
      return true;
    } catch (e) {
      this.error = msg(e);
      toastError(e);
      return false;
    }
  }

  /** A worktree's stable icon key: its branch name, or its path when detached. */
  branchIconKey(row: { branch: string | null; path: string }): string {
    return row.branch ?? row.path;
  }

  /** The custom icon stored for a worktree's branch, or undefined. */
  branchIcon(repoId: string, branchKey: string): string | undefined {
    return app.repos.find((r) => r.id === repoId)?.branchIcons?.[branchKey];
  }

  /** Register several project folders at once (the picker's "add all separately"
   *  action, one project per child folder). Adds them in order, skips ones that
   *  fail, and returns how many were added / failed; `error` is set only when
   *  every path failed. */
  async addProjectPaths(
    paths: string[],
  ): Promise<{ added: number; failed: number }> {
    this.error = null;
    let added = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const path of paths) {
      try {
        const repo = await repoAdd(path);
        if (!app.repos.find((r) => r.id === repo.id)) app.repos.push(repo);
        await this.loadWorktrees(repo.id);
        added += 1;
      } catch (e) {
        failed += 1;
        lastError = msg(e);
      }
    }
    if (added === 0 && lastError) this.error = lastError;
    if (added > 0) {
      toast.success(
        i18n.t(
          failed > 0 ? "toast.projectsAddedSome" : "toast.projectsAdded",
          { added: String(added), failed: String(failed) },
        ),
      );
    }
    return { added, failed };
  }

  async removeProject(id: string): Promise<void> {
    this.error = null;
    try {
      // Collect the repo's worktree paths (+ its root) before dropping them, so
      // scoped quick commands bound to any of them are pruned too.
      const repo = app.repos.find((r) => r.id === id);
      const worktreePaths = [
        ...(this.worktreesByRepo[id] ?? []).map((w) => w.path),
        ...(repo ? [repo.path] : []),
      ];
      await repoRemove(id);
      app.repos = app.repos.filter((r) => r.id !== id);
      const { [id]: _removed, ...rest } = this.worktreesByRepo;
      this.worktreesByRepo = rest;
      app.pruneProjectCommands(id, worktreePaths);
      toast.success(i18n.t("toast.projectRemoved"));
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    }
  }

  /** Create a worktree, then refresh its repo's list and reveal the section.
   *  Options mirror the backend command: `base` (new-branch mode's ref to branch
   *  from), `fromExisting` (check out an existing local/remote branch instead of
   *  creating one), and a custom `path`. `agentId` overrides which agent to
   *  launch into it: a specific agent id, or `null` for none. Omit it
   *  (`undefined`) to fall back to the global default agent. */
  async createWorktree(
    repoId: string,
    branch: string,
    options: {
      base?: string;
      fromExisting?: boolean;
      path?: string;
      agentId?: string | null;
    } = {},
  ): Promise<boolean> {
    this.error = null;
    try {
      const created = await worktreeCreate(repoId, branch, {
        base: options.base,
        fromExisting: options.fromExisting,
        path: options.path,
        // Fence the write to the machine this project lives on, as it was when
        // the dialog opened: creating a worktree writes to disk.
        expect: expectation(app.repos.find((r) => r.id === repoId)?.target),
      });
      await this.adoptWorktree(repoId, created, options.agentId);
      return true;
    } catch (e) {
      this.error = msg(e);
      return false;
    }
  }

  /** Materialize a pull request or issue as a worktree and land it through the
   *  same adoption path as manual creation. Returns the canonical path so a
   *  launcher can open its selected terminals/agents after creation. */
  async createGitHubWorktree(
    repoId: string,
    kind: "pr" | "issue",
    number: number,
    branch: string,
    agentId?: string | null,
  ): Promise<string | null> {
    this.error = null;
    try {
      const created =
        kind === "pr"
          ? await githubPrCheckout(repoId, String(number), branch)
          : await githubIssueDevelop(repoId, String(number), branch);
      await this.adoptWorktree(repoId, created, agentId);
      return created.path;
    } catch (e) {
      this.error = msg(e);
      return null;
    }
  }

  /** Take a freshly-created worktree into the UI: refresh its repo's canonical
   *  list, make it the active context, and launch an agent into it. Its status
   *  badge hydrates in the background so unrelated worktrees cannot delay the
   *  launch. Shared by
   *  [`createWorktree`] and the GitHub PR-checkout / issue-develop flows, which
   *  build their worktree on the backend but must land in exactly the same state
   *  — otherwise a GitHub-created worktree arrives with no agent, unlike every
   *  other one.
   *
   *  `agentId`: a specific agent id, `null` for none, or `undefined` to fall back
   *  to the global default agent. */
  async adoptWorktree(
    repoId: string,
    created: WorktreeEntry,
    agentId?: string | null,
  ): Promise<void> {
    await this.loadWorktrees(repoId, false);
    this.setActiveWorktree(created.path);
    void this.refreshStatuses([created.path]);
    const agent =
      agentId === undefined
        ? app.defaultAgent()
        : agentId
          ? app.launchableAgents.find((a) => a.id === agentId)
          : undefined;
    if (agent) app.launchAgent(agent, { cwd: created.path, workspace: created.path });
  }

  /** Remove a worktree. Branch cleanup is opt-in via `cleanup` (delete local /
   *  remote / force) — omit it to remove only the worktree. Returns false (with
   *  `error` set) when it was refused for having uncommitted changes and `force`
   *  was not set. */
  async removeWorktree(
    row: WorktreeRow,
    force: boolean,
    cleanup?: BranchCleanup,
  ): Promise<boolean> {
    this.error = null;
    try {
      // Kill the worktree's terminals/agents FIRST: on Windows a process whose
      // working directory is inside the worktree holds the folder open and
      // blocks git from deleting it (which left half-removed worktrees before).
      terminals.dropWorkspace(row.path);
      if (this.activeWorktreePath === row.path) this.activeWorktreePath = null;
      // Let the OS release the just-killed processes' directory handles.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const outcome = await worktreeRemove(
        row.repoId,
        row.path,
        row.branch,
        force,
        cleanup,
        // The most destructive command in the app: fence it to the machine the
        // user was actually looking at when they confirmed.
        expectation(app.repos.find((r) => r.id === row.repoId)?.target),
      );
      await this.loadWorktrees(row.repoId);
      // Drop any quick commands scoped to the now-removed worktree.
      app.pruneWorktreeCommands(row.path);
      this.dropNote(row.path);
      // The worktree is always gone; compose a message from what the opt-in
      // branch cleanup did (deleted / cleaned up / kept unmerged / remote).
      const parts = [i18n.t("toast.worktreeRemoved")];
      if (outcome?.localBranchDeleted) {
        parts.push(
          outcome.squashMerged
            ? i18n.t("toast.branchCleanedSquash")
            : i18n.t("toast.localBranchDeleted"),
        );
      } else if (outcome?.localBranchUnmerged) {
        parts.push(i18n.t("toast.localBranchKeptUnmerged"));
      }
      if (outcome?.remoteBranchDeleted) {
        parts.push(i18n.t("toast.remoteBranchDeleted"));
      }
      toast.success(parts.join(" · "));
      // A requested delete that git refused is surfaced separately (the worktree
      // still went, so it's a warning, not a hard failure) — but it MUST be
      // surfaced: the success toast above is composed from the flags, so a local
      // delete that silently failed used to read as if the branch were gone.
      if (outcome?.localBranchError) {
        toastError(i18n.t("toast.localBranchError", { error: outcome.localBranchError }));
      }
      if (outcome?.remoteError) {
        toastError(i18n.t("toast.remoteBranchError", { error: outcome.remoteError }));
      }
      return true;
    } catch (e) {
      this.error = msg(e);
      return false;
    }
  }

  /** Accept either a worktree path or a workspace key, and answer with both.
   *
   *  Callers hold one or the other depending on where they sit: a sidebar row
   *  has the path, the terminal area has the key of the workspace it is showing.
   *  For a local project the two are the same string, so passing the wrong one
   *  was invisible — until a remote key (`ssh:h1::C:/…`) reached the launcher as
   *  a path and every option in that menu opened a shell **here**, in this PC's
   *  home, because no project matched and the cwd was a string no filesystem
   *  has. Normalizing at the entry point is what keeps that from being every
   *  caller's problem to remember. */
  private locate(pathOrKey: string): { path: string; target: TargetId } {
    const parsed = parseWorkspaceKey(pathOrKey);
    if (!isLocalTarget(parsed.target)) return parsed;
    return { path: pathOrKey, target: this.targetForPath(pathOrKey) };
  }

  /** The machine a worktree path lives on: the target of the project that owns
   *  it. Looked up rather than inferred from the path, because the same absolute
   *  path can be registered on two machines at once and only the registration
   *  says which one a row came from. Unknown paths are local — that is what every
   *  path meant before hosts existed. */
  targetForPath(path: string): TargetId {
    const owner = app.repos.find(
      (repo) =>
        samePath(repo.path, path) ||
        (this.worktreesByRepo[repo.id] ?? []).some((w) => samePath(w.path, path)),
    );
    return targetOf(owner?.target);
  }

  /** The terminal-workspace key for a worktree path on a given machine. Two hosts
   *  with the same absolute path are two workspaces, which is the whole point. */
  workspaceFor(path: string, target: TargetId = this.targetForPath(path)): string {
    return workspaceKey(target, path);
  }

  /** Select a worktree: highlight it and show its terminal workspace. Opening it
   *  clears its "unread agent result" badge. */
  setActiveWorktree(pathOrKey: string, knownTarget?: TargetId): void {
    const { path, target } = this.locate(pathOrKey);
    if (knownTarget !== undefined) return this.select(path, knownTarget);
    return this.select(path, target);
  }

  private select(path: string, target: TargetId): void {
    this.activeWorktreePath = path;
    terminals.setWorkspace(this.workspaceFor(path, target));
    unread.clear(path);
    this.stampActive(path);
    // Activating a workspace (a worktree/project click) returns to the normal
    // terminal view: close the inline GitHub view if it was open.
    app.closeGithub();
  }

  /** Open a terminal in `path`'s workspace (and switch to it). An optional
   *  `profileId` opens that terminal profile instead of the default shell.
   *
   *  The path is handed over as the cwd *and* the machine as the target: on a
   *  host that folder is exactly where the shell should start, and without the
   *  target it would be a local shell trying to `cd` into someone else's path. */
  openTerminalAt(pathOrKey: string, profileId?: string): void {
    const { path, target } = this.locate(pathOrKey);
    this.activeWorktreePath = path;
    this.stampActive(path);
    app.openTerminal({
      cwd: path,
      title: baseName(path),
      workspace: this.workspaceFor(path, target),
      target,
      profileId,
    });
  }

  /** Launch an agent in `path`'s workspace (and switch to it). */
  launchAgentAt(pathOrKey: string, agent: AgentProfile): void {
    const { path, target } = this.locate(pathOrKey);
    this.activeWorktreePath = path;
    app.launchAgent(agent, { cwd: path, workspace: this.workspaceFor(path, target), target });
  }

  // --- Quick commands ------------------------------------------------------

  /** Build the active-workspace context quick commands resolve against (token
   *  substitution + cwd). Reads the live active workspace + its repo/branch. */
  commandContext(): CommandContext {
    const ws = terminals.activeWorkspace;
    const repo = this.activeRepo;
    let branch: string | null = null;
    if (repo && ws && ws !== GLOBAL_WORKSPACE) {
      branch = this.worktreesOf(repo.id).find((w) => w.path === ws)?.branch ?? null;
    }
    return {
      worktreePath: ws === GLOBAL_WORKSPACE ? "" : ws,
      branch,
      repoId: repo?.id ?? null,
      repoPath: repo?.path ?? null,
      repoName: repo?.name ?? null,
    };
  }

  /** Run a quick command: substitute its tokens against the active context,
   *  resolve its shell, and dispatch to a fresh terminal tab or the focused
   *  terminal. The `active` target falls back to a new tab when no terminal is
   *  focused. Confirmation (if the command opts in) is handled by the caller. */
  async runQuickCommand(cmd: QuickCommand): Promise<void> {
    const ctx = this.commandContext();
    const command = substituteTokens(cmd.command, ctx);
    const execute = cmd.runMode === "execute";

    // Type into the currently-focused terminal when asked (and one exists).
    if (cmd.target === "active") {
      const id = terminals.activePtyId();
      if (id) {
        try {
          await ptyWrite(id, command + (execute ? "\r" : ""));
        } catch (e) {
          this.error = msg(e);
        }
        return;
      }
      // No focused terminal — fall through to a new tab.
    }

    // Resolve the shell: the command's pinned terminal profile, else the default.
    const profile = cmd.shellProfileId
      ? app.profile(cmd.shellProfileId)
      : app.defaultProfile();
    const shell = profile?.command?.trim() || undefined;
    const cwd = resolveCommandCwd(cmd, ctx);
    terminals.create({
      cwd,
      title: cmd.name.trim() || baseName(command),
      shell,
      args: shell ? profile?.args : undefined,
      runCommand: command,
      runCommandExecute: execute,
      workspace: ctx.worktreePath || undefined,
    });
  }

  /** Friendly label for a workspace key (repo / branch), for the breadcrumb. The
   *  Global terminal space has no repo; a registered repo resolves to its main
   *  branch; a worktree resolves to its branch. */
  contextLabel(key: string): { repo?: string; name: string } {
    if (key === GLOBAL_WORKSPACE) return { name: i18n.t("terminal.general") };
    const mainRepo = app.repos.find((r) => r.path === key);
    if (mainRepo) {
      return {
        repo: mainRepo.name,
        name: this.mainWorktree(mainRepo.id)?.branch ?? "main",
      };
    }
    for (const r of app.repos) {
      const wt = this.worktreesOf(r.id).find((w) => w.path === key);
      if (wt) return { repo: r.name, name: wt.branch ?? baseName(key) };
    }
    return { name: baseName(key) };
  }

  /** The active terminal workspace's breadcrumb label (reactive). */
  get activeContext(): { repo?: string; name: string } {
    return this.contextLabel(terminals.activeWorkspace);
  }
}

/** Singleton projects store shared across the left panel. */
export const projects = new ProjectsStore();

// Let the signal sites that can't import this module (agent hooks, git actions —
// `projects` imports *them*) ask for a status sweep without closing a cycle.
registerStatusSweep(() => projects.requestStatusSweep());
