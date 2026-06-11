// Projects & worktrees state for the left panel (Svelte 5 runes).
//
// `app.repos` stays the canonical, backend-hydrated repo list; this store owns
// the sidebar-specific concerns layered on top: the per-repo worktree lists
// (loaded on demand and shown in a single global "Worktrees" section), the
// shared search query, the collapse state of the two sections, and the
// currently-active worktree. All git mutations go through `$lib/api`.

import {
  branchList,
  pickDirectory,
  repoAdd,
  repoRemove,
  worktreeCreate,
  worktreeList,
  worktreeRemove,
  worktreeStatus,
} from "$lib/api";
import type { BranchList, WorktreeEntry, WorktreeStatus } from "$lib/types";
import { app } from "$lib/state/app.svelte";

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
  /** Shared search query filtering both sections. */
  query = $state("");
  /** Collapse state of the two stacked sections (worktrees collapsed by default). */
  projectsCollapsed = $state(false);
  worktreesCollapsed = $state(true);

  /** Worktrees per repo id, loaded on demand. */
  worktreesByRepo = $state<Record<string, WorktreeEntry[]>>({});
  /** Working-tree status per worktree path (dirty/ahead/behind), best-effort. */
  statusByPath = $state<Record<string, WorktreeStatus>>({});
  /** Active worktree, keyed by its path (WorktreeEntry has no stable id). */
  activeWorktreePath = $state<string | null>(null);
  /** Last error from a project/worktree action, surfaced in the panel. */
  error = $state<string | null>(null);

  /** Projects filtered by the shared query (name or path). */
  filteredRepos = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    const repos = app.repos;
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  });

  /** All worktrees across every repo, flattened and filtered by the query. */
  filteredWorktrees = $derived.by(() => {
    const rows: WorktreeRow[] = [];
    for (const repo of app.repos) {
      for (const wt of this.worktreesByRepo[repo.id] ?? []) {
        rows.push({ ...wt, repoId: repo.id, repoName: repo.name });
      }
    }
    const q = this.query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (w) =>
        (w.branch ?? "").toLowerCase().includes(q) ||
        w.path.toLowerCase().includes(q) ||
        w.repoName.toLowerCase().includes(q),
    );
  });

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

  /** A repo's branches + resolved default base, for the new-worktree dialog. */
  branchInfo(repoId: string): Promise<BranchList> {
    return branchList(repoId);
  }

  async addProject(): Promise<void> {
    this.error = null;
    try {
      const path = await pickDirectory("Select a git repository");
      if (!path) return;
      const repo = await repoAdd(path);
      if (!app.repos.find((r) => r.id === repo.id)) app.repos.push(repo);
      await this.loadWorktrees(repo.id);
    } catch (e) {
      this.error = msg(e);
    }
  }

  async removeProject(id: string): Promise<void> {
    this.error = null;
    try {
      await repoRemove(id);
      app.repos = app.repos.filter((r) => r.id !== id);
      const { [id]: _removed, ...rest } = this.worktreesByRepo;
      this.worktreesByRepo = rest;
    } catch (e) {
      this.error = msg(e);
    }
  }

  /** Create a worktree, then refresh its repo's list and reveal the section. */
  async createWorktree(
    repoId: string,
    branch: string,
    base?: string,
  ): Promise<boolean> {
    this.error = null;
    try {
      const created = await worktreeCreate(repoId, branch, base);
      await this.loadWorktrees(repoId);
      this.worktreesCollapsed = false;
      this.activeWorktreePath = created.path;
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
      await worktreeRemove(row.repoId, row.path, row.branch, force);
      await this.loadWorktrees(row.repoId);
      if (this.activeWorktreePath === row.path) this.activeWorktreePath = null;
      return true;
    } catch (e) {
      this.error = msg(e);
      return false;
    }
  }

  setActiveWorktree(path: string): void {
    this.activeWorktreePath = path;
  }

  /** Open a terminal (default profile) whose shell starts in `path`. */
  openTerminalAt(path: string): void {
    app.openTerminal({ cwd: path, title: baseName(path) });
  }
}

/** Singleton projects store shared across the left panel. */
export const projects = new ProjectsStore();
