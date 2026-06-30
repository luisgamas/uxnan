// Projects & worktrees state for the left panel (Svelte 5 runes).
//
// `app.repos` stays the canonical, backend-hydrated repo list; this store owns
// the sidebar-specific concerns layered on top: the per-repo worktree lists
// (loaded on demand and shown in a single global "Worktrees" section), the
// shared search query, the collapse state of the two sections, and the
// currently-active worktree. All git mutations go through `$lib/api`.

import {
  branchList,
  repoAdd,
  repoRemove,
  worktreeCreate,
  worktreeList,
  worktreeRemove,
  worktreeStatus,
} from "$lib/api";
import type {
  AgentProfile,
  BranchList,
  WorktreeEntry,
  WorktreeStatus,
} from "$lib/types";
import { app } from "$lib/state/app.svelte";
import { terminals, GLOBAL_WORKSPACE } from "$lib/state/terminals.svelte";
import { unread } from "$lib/state/unread.svelte";
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

  /** Load every repo's worktrees (called once after the app hydrates). */
  async init(): Promise<void> {
    await Promise.all(app.repos.map((r) => this.loadWorktrees(r.id)));
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

  /** Register a git repository by path (from the in-app directory picker).
   *  Returns false (with `error` set) when the path isn't a git repo. */
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

  async removeProject(id: string): Promise<void> {
    this.error = null;
    try {
      await repoRemove(id);
      app.repos = app.repos.filter((r) => r.id !== id);
      const { [id]: _removed, ...rest } = this.worktreesByRepo;
      this.worktreesByRepo = rest;
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
      await this.loadWorktrees(repoId);
      // Select the new worktree as the active context.
      this.setActiveWorktree(created.path);
      // Launch the chosen agent into it (per-worktree override, else the global
      // default, else none). Opt-in: `null` explicitly launches nothing.
      const agent =
        agentId === undefined
          ? app.defaultAgent()
          : agentId
            ? app.launchableAgents.find((a) => a.id === agentId)
            : undefined;
      if (agent) app.launchAgent(agent, { cwd: created.path, workspace: created.path });
      return true;
    } catch (e) {
      this.error = msg(e);
      return false;
    }
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
  }

  /** Open a terminal in `path`'s workspace (and switch to it). An optional
   *  `profileId` opens that terminal profile instead of the default shell. */
  openTerminalAt(path: string, profileId?: string): void {
    this.activeWorktreePath = path;
    app.openTerminal({ cwd: path, title: baseName(path), workspace: path, profileId });
  }

  /** Launch an agent in `path`'s workspace (and switch to it). */
  launchAgentAt(path: string, agent: AgentProfile): void {
    this.activeWorktreePath = path;
    app.launchAgent(agent, { cwd: path, workspace: path });
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
