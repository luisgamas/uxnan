// Projects & worktrees state for the left panel (Svelte 5 runes).
//
// `app.repos` stays the canonical, backend-hydrated repo list; this store owns
// the sidebar-specific concerns layered on top: the per-repo worktree lists
// (loaded on demand and shown in a single global "Worktrees" section), the
// shared search query, the collapse state of the two sections, and the
// currently-active worktree. All git mutations go through `$lib/api`.

import {
  branchList,
  ptyWrite,
  repoAdd,
  repoRemove,
  repoReorder as apiRepoReorder,
  repoSetBranchIcon,
  repoUpdate,
  setWorktreeOrder as apiSetWorktreeOrder,
  worktreeCreate,
  worktreeList,
  worktreeRemove,
  worktreeStatus,
} from "$lib/api";
import type {
  AgentProfile,
  BranchList,
  QuickCommand,
  RepoData,
  SidebarGroupBy,
  SortMode,
  WorktreeEntry,
  WorktreeStatus,
} from "$lib/types";
import { app } from "$lib/state/app.svelte";
import { registerFlush } from "$lib/state/flushRegistry";
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
import { toast, toastError } from "$lib/toast";
import { i18n } from "$lib/i18n";

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

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
    const main = app.repos.find((r) => r.path === key);
    if (main) return main;
    for (const r of app.repos) {
      if (this.worktreesOf(r.id).some((w) => w.path === key)) return r;
    }
    return null;
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
    return buildStatusGroups(all, (w) => this.worktreeSortMeta(w)).map((lane) => ({
      attention: lane.attention,
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

  /** Load every repo's worktrees (called once after the app hydrates). */
  async init(): Promise<void> {
    // Force the pending workspace-recency stamp on window close (idempotent id).
    registerFlush("workspace-last-active", () => this.flushLastActive());
    await Promise.all(app.repos.map((r) => this.loadWorktrees(r.id)));
  }

  /**
   * Reconcile worktrees that may have been created outside the ADE (for example
   * by an agent CLI). The backend has no reliable cross-platform worktree
   * filesystem event, so the sidebar uses a small polling pass. Only changed
   * lists are assigned, which keeps the sort settle window and row rendering
   * stable while still making externally-created worktrees appear promptly.
   */
  async refreshWorktrees(): Promise<void> {
    if (this.worktreeRefreshInFlight) return;
    this.worktreeRefreshInFlight = true;
    try {
      await Promise.all(
        app.repos.map(async (repo) => {
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

  async loadWorktrees(repoId: string): Promise<void> {
    try {
      const list = await worktreeList(repoId);
      this.worktreesByRepo = { ...this.worktreesByRepo, [repoId]: list };
      await this.refreshStatuses(list.map((w) => w.path));
    } catch (e) {
      this.error = msg(e);
      toastError(e);
    }
  }

  /** Best-effort refresh of the git status badges for the given worktree paths. */
  async refreshStatuses(paths: string[]): Promise<void> {
    const entries = await Promise.all(
      paths.map(async (path) => {
        try {
          return [path, await worktreeStatus(path)] as const;
        } catch {
          return null;
        }
      }),
    );
    const merged = { ...this.statusByPath };
    for (const entry of entries) if (entry) merged[entry[0]] = entry[1];
    this.statusByPath = merged;
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
   *  `agentId` overrides which agent to launch into it: a specific agent id, or
   *  `null` for none. Omit it (`undefined`) to fall back to the global default
   *  agent (the legacy behavior). */
  async createWorktree(
    repoId: string,
    branch: string,
    base?: string,
    agentId?: string | null,
  ): Promise<boolean> {
    this.error = null;
    try {
      const created = await worktreeCreate(repoId, branch, base);
      await this.adoptWorktree(repoId, created, agentId);
      return true;
    } catch (e) {
      this.error = msg(e);
      return false;
    }
  }

  /** Take a freshly-created worktree into the UI: refresh its repo's list, make
   *  it the active context, and launch an agent into it. Shared by
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
    await this.loadWorktrees(repoId);
    this.setActiveWorktree(created.path);
    const agent =
      agentId === undefined
        ? app.defaultAgent()
        : agentId
          ? app.launchableAgents.find((a) => a.id === agentId)
          : undefined;
    if (agent) app.launchAgent(agent, { cwd: created.path, workspace: created.path });
  }

  /** Remove a worktree. Returns false (with `error` set) when it was refused
   *  for having uncommitted changes and `force` was not set. */
  async removeWorktree(row: WorktreeRow, force: boolean): Promise<boolean> {
    this.error = null;
    try {
      // Kill the worktree's terminals/agents FIRST: on Windows a process whose
      // working directory is inside the worktree holds the folder open and
      // blocks git from deleting it (which left half-removed worktrees before).
      terminals.dropWorkspace(row.path);
      if (this.activeWorktreePath === row.path) this.activeWorktreePath = null;
      // Let the OS release the just-killed processes' directory handles.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const outcome = await worktreeRemove(row.repoId, row.path, row.branch, force);
      await this.loadWorktrees(row.repoId);
      // Drop any quick commands scoped to the now-removed worktree.
      app.pruneWorktreeCommands(row.path);
      // The worktree is gone either way; the message depends on what happened to
      // the branch (kept because unmerged / cleaned up after a squash merge).
      if (outcome?.branchPreserved) {
        toast.success(i18n.t("toast.worktreeRemovedBranchKept"));
      } else if (outcome?.squashMerged) {
        toast.success(i18n.t("toast.worktreeRemovedSquash"));
      } else {
        toast.success(i18n.t("toast.worktreeRemoved"));
      }
      return true;
    } catch (e) {
      this.error = msg(e);
      return false;
    }
  }

  /** Select a worktree: highlight it and show its terminal workspace. Opening it
   *  clears its "unread agent result" badge. */
  setActiveWorktree(path: string): void {
    this.activeWorktreePath = path;
    terminals.setWorkspace(path);
    unread.clear(path);
    this.stampActive(path);
  }

  /** Open a terminal in `path`'s workspace (and switch to it). An optional
   *  `profileId` opens that terminal profile instead of the default shell. */
  openTerminalAt(path: string, profileId?: string): void {
    this.activeWorktreePath = path;
    this.stampActive(path);
    app.openTerminal({ cwd: path, title: baseName(path), workspace: path, profileId });
  }

  /** Launch an agent in `path`'s workspace (and switch to it). */
  launchAgentAt(path: string, agent: AgentProfile): void {
    this.activeWorktreePath = path;
    app.launchAgent(agent, { cwd: path, workspace: path });
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
