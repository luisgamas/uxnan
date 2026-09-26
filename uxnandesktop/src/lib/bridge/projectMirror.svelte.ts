// The desktop's projects and the bridge's project registry, kept as one list
// (architecture/02a §5.8.17, "total mirror"): a project added or removed here
// is added or removed in the registry — and so on the phone — and one the
// phone adds or removes is added or removed here. Removing a project never
// deletes its conversations, on either side.
//
// Only local projects take part: an SSH project lives on another machine,
// which this bridge cannot reach.
//
// Safety rules:
// - On (re)connect the two lists are UNITED: nothing is ever removed because
//   it is merely absent on the other side.
// - A removal only travels as an explicit event. One made here while the
//   bridge was unreachable is remembered and sent on the next connection, so
//   the union does not bring the project back.
// - Folders are compared through the bridge's own resolution
//   (`project/resolve`), which follows symlinks and maps a worktree to its
//   repository — the same identity the registry keys on.

import type { Project } from '$shared/models/project';
import type { RepoData } from '$lib/types';
import { app } from '$lib/state/app.svelte';
import { projects, type ProjectChangeOrigin } from '$lib/state/projects.svelte';
import { isLocalTarget } from '$lib/target';
import { bridge } from './client.svelte';
import { chat, normalizeCwd, type ReplicaChange } from './chat.svelte';

/** Removals made while the bridge was unreachable (per-viewer, best-effort). */
const PENDING_KEY = 'uxnan.bridge.pendingProjectRemovals';

function readPending(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function writePending(paths: string[]): void {
  try {
    if (paths.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(paths));
  } catch {
    /* storage unavailable: the removal is simply not replayed */
  }
}

export class ProjectMirror {
  #started = false;
  /** Local path → the registry id its folder resolves to. */
  readonly #idByPath = new Map<string, string>();
  #reconciling: Promise<void> | undefined;

  start(): void {
    if (this.#started) return;
    this.#started = true;
    chat.onReplicaChange((change) => void this.#onReplica(change));
    projects.onRepoAdded((repo, origin) => void this.#onLocalAdded(repo, origin));
    projects.onRepoRemoved((repo, origin) => void this.#onLocalRemoved(repo, origin));
  }

  #localRepos(): RepoData[] {
    return app.repos.filter((r) => isLocalTarget(r.target));
  }

  /** The registry id a local folder belongs to (asked once per folder). */
  async #idOf(path: string): Promise<string | undefined> {
    const key = normalizeCwd(path);
    const known = this.#idByPath.get(key);
    if (known) return known;
    try {
      const project = await bridge.call<Project>('project/resolve', { cwd: path });
      this.#idByPath.set(key, project.id);
      return project.id;
    } catch {
      return undefined;
    }
  }

  async #onReplica(change: ReplicaChange): Promise<void> {
    if (change.type !== 'projects') return;
    // Explicit removals from another client: take the project out here too.
    for (const gone of change.removed) {
      for (const repo of this.#localRepos()) {
        if ((await this.#idOf(repo.path)) === gone.id) {
          await projects.removeProject(repo.id, 'bridge');
        }
      }
    }
    if (change.reset || change.projects.length > 1) {
      await this.reconcile();
    } else {
      for (const project of change.projects) await this.#adopt(project);
    }
  }

  /** Unite both lists (on every full sync). Serialized. */
  reconcile(): Promise<void> {
    this.#reconciling ??= (async () => {
      try {
        await this.#flushPendingRemovals();
        const registered = new Set(chat.projects.keys());
        // Ours the registry lacks → publish them.
        const localIds = new Set<string>();
        for (const repo of this.#localRepos()) {
          const id = await this.#idOf(repo.path);
          if (!id) continue;
          localIds.add(id);
          if (!registered.has(id)) await this.#publish(repo);
        }
        // The registry's we lack → add them here.
        for (const project of chat.projects.values()) {
          if (!localIds.has(project.id)) await this.#adopt(project);
        }
      } finally {
        this.#reconciling = undefined;
      }
    })();
    return this.#reconciling;
  }

  /** Add a registry project here unless a local project already is it. */
  async #adopt(project: Project): Promise<void> {
    for (const repo of this.#localRepos()) {
      if ((await this.#idOf(repo.path)) === project.id) return;
    }
    this.#idByPath.set(normalizeCwd(project.cwd), project.id);
    await projects.addProjectPath(project.cwd, 'bridge');
  }

  async #publish(repo: RepoData): Promise<void> {
    try {
      const project = await bridge.call<Project>('project/add', {
        cwd: repo.path,
        name: repo.name,
      });
      this.#idByPath.set(normalizeCwd(repo.path), project.id);
    } catch {
      /* not connected: the next reconcile publishes it */
    }
  }

  async #onLocalAdded(repo: RepoData, origin: ProjectChangeOrigin): Promise<void> {
    if (origin !== 'local' || !isLocalTarget(repo.target) || !bridge.connected) return;
    await this.#publish(repo);
  }

  async #onLocalRemoved(repo: RepoData, origin: ProjectChangeOrigin): Promise<void> {
    if (origin !== 'local' || !isLocalTarget(repo.target)) return;
    if (!bridge.connected) {
      writePending([...new Set([...readPending(), repo.path])]);
      return;
    }
    await this.#unpublish(repo.path);
  }

  async #unpublish(path: string): Promise<void> {
    const id = await this.#idOf(path);
    if (!id) return;
    try {
      await bridge.call('project/remove', { projectId: id });
    } catch {
      writePending([...new Set([...readPending(), path])]);
    }
  }

  async #flushPendingRemovals(): Promise<void> {
    const pending = readPending();
    if (pending.length === 0) return;
    writePending([]);
    for (const path of pending) await this.#unpublish(path);
  }
}

export const projectMirror = new ProjectMirror();
