// The desktop's projects and the bridge's project registry, kept as one list
// (architecture/02a §5.8.17, "total mirror"): a project added or removed here
// is added or removed in the registry — and so on the phone — and one the
// phone adds or removes is added or removed here. Removing a project never
// deletes its conversations, on either side: they are listed under "No
// project" until it is added again.
//
// Only local projects take part: an SSH project lives on another machine,
// which this bridge cannot reach.
//
// Converging after a gap — the app closed, the bridge stopped — never trusts
// that every removal event arrived. The mirror remembers, durably, which local
// projects it has seen in the registry (`mirrored`, per bridge state
// `storeId`). On every whole sync:
// - a local project the registry has: mirrored;
// - a local project the registry lacks that WAS mirrored: someone removed it
//   while this window could not hear it — it is removed here too (this used to
//   publish it again, bringing back a project the phone had removed);
// - a local project the registry lacks that was never mirrored (added here
//   while the bridge was unreachable, or before this record existed): published;
// - a registry project with no local twin: added here.
// A removal made here while the bridge was unreachable is kept in the same
// record and sent on the next sync, so it is never lost nor undone.
//
// Folders are compared through the bridge's own resolution
// (`project/resolve`), which follows symlinks and maps a worktree to its
// repository — the same identity the registry keys on.

import type { Project } from '$shared/models/project';
import type { RepoData } from '$lib/types';
import { app } from '$lib/state/app.svelte';
import { projects, type ProjectChangeOrigin } from '$lib/state/projects.svelte';
import { isLocalTarget } from '$lib/target';
import { bridge } from './client.svelte';
import { chat, normalizeCwd, type ReplicaChange } from './chat.svelte';

/** Where the record lives: the window's storage, on disk, kept across restarts. */
const RECORD_KEY = 'uxnan.bridge.projectMirror';

/** What the mirror remembers between runs. */
interface MirrorRecord {
  /** The bridge state [mirrored] belongs to; another store means nothing is known. */
  storeId?: string;
  /** Registry ids of local projects seen in the registry. */
  mirrored: string[];
  /** Local folders removed here that the registry has not heard of yet. */
  pendingRemovals: string[];
}

function readRecord(): MirrorRecord {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<MirrorRecord>) : {};
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return {
      ...(typeof parsed.storeId === 'string' ? { storeId: parsed.storeId } : {}),
      mirrored: strings(parsed.mirrored),
      pendingRemovals: strings(parsed.pendingRemovals),
    };
  } catch {
    return { mirrored: [], pendingRemovals: [] };
  }
}

function writeRecord(record: MirrorRecord): void {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable: this run still mirrors; the next start unites */
  }
}

export class ProjectMirror {
  #started = false;
  /** Local path → the registry id its folder resolves to. */
  readonly #idByPath = new Map<string, string>();
  #reconciling: Promise<void> | undefined;
  #again = false;

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

  #update(fn: (record: MirrorRecord) => void): void {
    const record = readRecord();
    fn(record);
    record.mirrored = [...new Set(record.mirrored)];
    record.pendingRemovals = [...new Set(record.pendingRemovals)];
    writeRecord(record);
  }

  async #onReplica(change: ReplicaChange): Promise<void> {
    if (change.type !== 'projects') return;
    // Explicit removals from another client: take the project out here too.
    for (const gone of change.removed) {
      this.#update((r) => (r.mirrored = r.mirrored.filter((id) => id !== gone.id)));
      for (const repo of this.#localRepos()) {
        if ((await this.#idOf(repo.path)) === gone.id) {
          await projects.removeProject(repo.id, 'bridge');
        }
      }
    }
    if (change.source === 'sync') {
      await this.reconcile(change.storeId);
    } else {
      for (const project of change.projects) await this.#adopt(project);
    }
  }

  /** Converge both lists after a whole sync (see the rules above). Serialized;
   *  one asked for while one runs runs once more after it. */
  reconcile(storeId?: string): Promise<void> {
    if (this.#reconciling) {
      this.#again = true;
      return this.#reconciling;
    }
    this.#reconciling = (async () => {
      try {
        do {
          this.#again = false;
          await this.#reconcileOnce(storeId);
        } while (this.#again);
      } finally {
        this.#reconciling = undefined;
      }
    })();
    return this.#reconciling;
  }

  async #reconcileOnce(storeId: string | undefined): Promise<void> {
    // Removed here and sent just now: the replica may not have heard yet.
    const justRemoved = await this.#flushPendingRemovals();
    const record = readRecord();
    // What was mirrored only counts for the same bridge state.
    const mirrored = new Set(
      storeId !== undefined && record.storeId === storeId ? record.mirrored : [],
    );
    const registered = new Set([...chat.projects.keys()].filter((id) => !justRemoved.has(id)));
    const localIds = new Set<string>();
    for (const repo of this.#localRepos()) {
      const id = await this.#idOf(repo.path);
      if (!id) continue;
      if (registered.has(id)) {
        localIds.add(id);
        mirrored.add(id);
      } else if (mirrored.has(id)) {
        // Removed elsewhere while this window could not hear it.
        mirrored.delete(id);
        await projects.removeProject(repo.id, 'bridge');
      } else if (await this.#publish(repo)) {
        localIds.add(id);
        mirrored.add(id);
      }
    }
    // The registry's we lack → add them here.
    for (const project of chat.projects.values()) {
      if (localIds.has(project.id) || justRemoved.has(project.id)) continue;
      await this.#adopt(project);
      mirrored.add(project.id);
    }
    this.#update((r) => {
      if (storeId !== undefined) r.storeId = storeId;
      r.mirrored = [...mirrored];
    });
  }

  /** Add a registry project here unless a local project already is it. */
  async #adopt(project: Project): Promise<void> {
    for (const repo of this.#localRepos()) {
      if ((await this.#idOf(repo.path)) === project.id) return;
    }
    this.#idByPath.set(normalizeCwd(project.cwd), project.id);
    await projects.addProjectPath(project.cwd, 'bridge');
  }

  async #publish(repo: RepoData): Promise<boolean> {
    try {
      const project = await bridge.call<Project>('project/add', {
        cwd: repo.path,
        name: repo.name,
      });
      this.#idByPath.set(normalizeCwd(repo.path), project.id);
      return true;
    } catch {
      /* not connected: the next sync publishes it */
      return false;
    }
  }

  async #onLocalAdded(repo: RepoData, origin: ProjectChangeOrigin): Promise<void> {
    if (origin !== 'local' || !isLocalTarget(repo.target) || !bridge.connected) return;
    if (await this.#publish(repo)) {
      const id = await this.#idOf(repo.path);
      if (id) this.#update((r) => r.mirrored.push(id));
    }
  }

  async #onLocalRemoved(repo: RepoData, origin: ProjectChangeOrigin): Promise<void> {
    if (origin !== 'local' || !isLocalTarget(repo.target)) return;
    if (!bridge.connected) {
      this.#update((r) => r.pendingRemovals.push(repo.path));
      return;
    }
    await this.#unpublish(repo.path);
  }

  /** Take [path]'s project off the registry; the id it removed, if it did. */
  async #unpublish(path: string): Promise<string | undefined> {
    const id = await this.#idOf(path);
    if (!id) {
      this.#update((r) => r.pendingRemovals.push(path));
      return undefined;
    }
    try {
      await bridge.call('project/remove', { projectId: id });
      this.#update((r) => (r.mirrored = r.mirrored.filter((m) => m !== id)));
      return id;
    } catch {
      this.#update((r) => r.pendingRemovals.push(path));
      return undefined;
    }
  }

  async #flushPendingRemovals(): Promise<Set<string>> {
    const removed = new Set<string>();
    const pending = readRecord().pendingRemovals;
    if (pending.length === 0) return removed;
    this.#update((r) => (r.pendingRemovals = []));
    for (const path of pending) {
      const id = await this.#unpublish(path);
      if (id) removed.add(id);
    }
    return removed;
  }
}

export const projectMirror = new ProjectMirror();
