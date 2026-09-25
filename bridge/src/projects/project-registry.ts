/**
 * The bridge's registry of projects — the ONE list the phone and Uxnan Desktop
 * mirror (architecture/02a §5.8.17).
 *
 * Persisted in `projects.json`. A project enters it when a client adds it
 * (`project/add`; the desktop publishes its own projects the same way), when a
 * conversation starts in its folder, or from the config's `workspaceRoots`; it
 * leaves only by `project/remove`, which never touches its conversations. Every
 * change takes a sync revision and is announced, so a project added on either
 * side appears on the other — including a phone that was away when it happened.
 *
 * A project is a **folder**, canonicalized (symlinks resolved), and a git
 * worktree belongs to the project of the repository it checks out: a
 * conversation in `…/worktrees/app/feature` lists under `app`, the same way the
 * desktop groups worktrees under their repository.
 *
 * Source: architecture/02a-system-architecture.md §5.8.5 (project resolution)
 * and §5.8.17 (one registry, mirrored).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  JsonRpcErrorCode,
  RpcError,
  type AgentConfig,
  type Project,
  type ProjectSource,
} from '@uxnan/shared';
import type { DaemonState } from '../daemon-state.js';
import { SyncLedger } from '../sync/sync-ledger.js';

export const PROJECTS_FILE = 'projects.json';

/** How long asking git which repository a folder belongs to may take. */
const GIT_TIMEOUT_MS = 3_000;

/**
 * Stable id of a canonical folder, so it survives restarts and is the same on
 * every client. Case-folded on Windows, whose paths are case-insensitive.
 */
export function projectIdFor(cwd: string): string {
  const key = process.platform === 'win32' ? resolve(cwd).toLowerCase() : resolve(cwd);
  return `proj_${createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
}

/** The folder with its symlinks resolved (`/tmp` → `/private/tmp` on macOS). */
export async function canonicalFolder(cwd: string): Promise<string> {
  const absolute = resolve(cwd);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

/**
 * The repository a folder belongs to: its main worktree when the folder is a
 * git checkout (a linked worktree maps to the repository it was created from),
 * the folder itself otherwise. Never throws — a folder git cannot read is its
 * own project.
 */
export function repositoryRoot(dir: string): Promise<string> {
  return new Promise((resolveRoot) => {
    execFile(
      'git',
      ['-C', dir, 'rev-parse', '--git-common-dir'],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        const commonDir = err ? '' : String(stdout).trim();
        if (commonDir.length === 0) return resolveRoot(dir);
        const absolute = resolve(dir, commonDir);
        // `<repo>/.git` → `<repo>`. A bare repository (`app.git`) or anything
        // unusual keeps the folder itself.
        resolveRoot(basename(absolute) === '.git' ? dirname(absolute) : dir);
      },
    );
  });
}

export type ProjectChange =
  | { type: 'updated'; project: Project }
  | { type: 'removed'; projectId: string; rev: number };

interface StoredProject {
  id: string;
  cwd: string;
  name: string;
  /** True once someone renamed it; otherwise the name follows the folder. */
  customName?: boolean;
  source: ProjectSource;
  addedAt: number;
  updatedAt: number;
  rev: number;
}

interface ProjectsFile {
  projects: StoredProject[];
}

export interface ProjectRegistryOptions {
  /** Where `projects.json` lives; omitted → kept in memory only (tests). */
  state?: DaemonState;
  ledger?: SyncLedger;
  /** Config `workspaceRoots`, registered on load (source `config`). */
  configRoots?: string[];
  /** Per-project agent/model pins from config, keyed by their `cwd`. */
  projectAgents?: AgentConfig[];
  now?: () => number;
  /** Injected repository lookup (tests); defaults to asking git. */
  repositoryRoot?: (dir: string) => Promise<string>;
}

export class ProjectRegistry {
  readonly #state: DaemonState | undefined;
  readonly #ledger: SyncLedger;
  readonly #configRoots: string[];
  readonly #agentByCwd: Map<string, AgentConfig>;
  readonly #now: () => number;
  readonly #repositoryRoot: (dir: string) => Promise<string>;
  readonly #projects = new Map<string, StoredProject>();
  readonly #listeners = new Set<(change: ProjectChange) => void>();
  #lock: Promise<unknown> = Promise.resolve();

  constructor(options: ProjectRegistryOptions = {}) {
    this.#state = options.state;
    this.#ledger = options.ledger ?? SyncLedger.memory();
    this.#configRoots = (options.configRoots ?? []).filter((r) => r.length > 0);
    this.#agentByCwd = new Map(
      (options.projectAgents ?? [])
        .filter((config) => typeof config.cwd === 'string' && config.cwd.length > 0)
        .map((config) => [resolve(config.cwd as string), config]),
    );
    this.#now = options.now ?? (() => Date.now());
    this.#repositoryRoot = options.repositoryRoot ?? repositoryRoot;
  }

  /**
   * Read `projects.json` and register the config's roots. Call once at startup.
   * Resolves `true` when there was no registry yet (a first run, or an upgrade
   * from a bridge that had none) — the caller seeds it from existing work.
   */
  async load(): Promise<boolean> {
    const file = this.#state ? await this.#state.readJson<ProjectsFile>(PROJECTS_FILE) : null;
    for (const stored of file?.projects ?? []) {
      if (typeof stored?.id !== 'string' || typeof stored.cwd !== 'string') continue;
      this.#projects.set(stored.id, stored);
      this.#ledger.observe(stored.rev);
    }
    for (const root of this.#configRoots) await this.add(root, { source: 'config' });
    if (file === null && this.#state) await this.#serialize(() => this.#persist());
    return file === null;
  }

  /** Listen for registry changes (after they are on disk). Returns an unsubscribe. */
  onChange(listener: (change: ProjectChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Every registered project, by name. */
  list(): Project[] {
    return [...this.#projects.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => this.#toProject(p));
  }

  /** Projects whose entry changed after revision [since] (all when omitted). */
  changedSince(since?: number): Project[] {
    return [...this.#projects.values()]
      .filter((p) => since === undefined || p.rev > since)
      .map((p) => this.#toProject(p));
  }

  /** A registered project by id, or `undefined`. */
  get(projectId: string): Project | undefined {
    const stored = this.#projects.get(projectId);
    return stored ? this.#toProject(stored) : undefined;
  }

  /** A registered project by id. Throws when it is not registered. */
  byId(projectId: string): Project {
    const project = this.get(projectId);
    if (!project) {
      throw new RpcError(JsonRpcErrorCode.ResourceNotFound, `unknown project: ${projectId}`);
    }
    return project;
  }

  /**
   * The project a folder belongs to: its registered entry, or — for a folder
   * nobody added — an unregistered description (no `source`) with the id it
   * WOULD have. Worktrees resolve to their repository's project.
   */
  async resolve(cwd: string): Promise<Project> {
    const root = await this.#projectFolder(cwd);
    const registered = this.#projects.get(projectIdFor(root));
    if (registered) return this.#toProject(registered);
    return this.#describe(root);
  }

  /**
   * Register the project a folder belongs to. Idempotent: a folder already
   * registered keeps its entry (and its name) and is returned as is.
   */
  add(cwd: string, options: { name?: string; source: ProjectSource }): Promise<Project> {
    return this.#serialize(async () => {
      const root = await this.#projectFolder(cwd);
      const id = projectIdFor(root);
      const existing = this.#projects.get(id);
      if (existing) return this.#toProject(existing);
      const now = this.#now();
      const name = options.name?.trim();
      const stored: StoredProject = {
        id,
        cwd: root,
        name: name && name.length > 0 ? name : defaultName(root),
        ...(name && name.length > 0 ? { customName: true } : {}),
        source: options.source,
        addedAt: now,
        updatedAt: now,
        rev: this.#ledger.next(),
      };
      this.#ledger.revive('project', id);
      this.#projects.set(id, stored);
      await this.#persist();
      const project = this.#toProject(stored);
      this.#emit({ type: 'updated', project });
      return project;
    });
  }

  /** Drop a project from the registry. Its conversations are untouched. */
  remove(projectId: string): Promise<boolean> {
    return this.#serialize(async () => {
      if (!this.#projects.delete(projectId)) return false;
      const rev = this.#ledger.tombstone('project', projectId);
      await this.#persist();
      this.#emit({ type: 'removed', projectId, rev });
      return true;
    });
  }

  /** Rename a project; an empty name goes back to the folder's name. */
  rename(projectId: string, name: string): Promise<Project> {
    return this.#serialize(async () => {
      const stored = this.#projects.get(projectId);
      if (!stored) {
        throw new RpcError(JsonRpcErrorCode.ResourceNotFound, `unknown project: ${projectId}`);
      }
      const trimmed = name.trim();
      const next = trimmed.length > 0 ? trimmed : defaultName(stored.cwd);
      if (next === stored.name && trimmed.length > 0 === (stored.customName === true)) {
        return this.#toProject(stored);
      }
      stored.name = next;
      if (trimmed.length > 0) stored.customName = true;
      else delete stored.customName;
      stored.updatedAt = this.#now();
      stored.rev = this.#ledger.next();
      await this.#persist();
      const project = this.#toProject(stored);
      this.#emit({ type: 'updated', project });
      return project;
    });
  }

  /** The pinned agent/model config for the project at `cwd`, if any. */
  agentConfigFor(cwd: string): AgentConfig | undefined {
    return this.#agentByCwd.get(resolve(cwd));
  }

  async #projectFolder(cwd: string): Promise<string> {
    const canonical = await canonicalFolder(cwd);
    const root = await this.#repositoryRoot(canonical);
    return root === canonical ? canonical : canonicalFolder(root);
  }

  #describe(cwd: string): Project {
    const pin = this.#agentByCwd.get(cwd);
    return {
      id: projectIdFor(cwd),
      name: defaultName(cwd),
      cwd,
      ...(pin?.agentId !== undefined ? { agentId: pin.agentId } : {}),
      ...(pin?.model !== undefined ? { model: pin.model } : {}),
    };
  }

  #toProject(stored: StoredProject): Project {
    return {
      ...this.#describe(stored.cwd),
      name: stored.name,
      source: stored.source,
      addedAt: stored.addedAt,
      updatedAt: stored.updatedAt,
      rev: stored.rev,
    };
  }

  async #persist(): Promise<void> {
    if (this.#state) {
      await this.#state.writeJson(PROJECTS_FILE, {
        projects: [...this.#projects.values()],
      } satisfies ProjectsFile);
    }
    // The revision reaches disk before anyone hears of it.
    await this.#ledger.flush();
  }

  #emit(change: ProjectChange): void {
    for (const listener of this.#listeners) {
      try {
        listener(change);
      } catch {
        /* a listener's failure is its own; the change is already stored */
      }
    }
  }

  #serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn, fn);
    this.#lock = run.catch(() => undefined);
    return run;
  }
}

function defaultName(cwd: string): string {
  return basename(cwd) || cwd;
}
