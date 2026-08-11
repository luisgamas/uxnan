/**
 * Persistent daemon state under `~/.uxnan/` (non-secret files only).
 *
 * Secrets (the Ed25519 private identity) live in a {@link SecretStore}, never in
 * these JSON files. Writes are atomic (temp file + rename).
 *
 * Source: architecture/02a-system-architecture.md §5.8.3.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DEFAULT_DAEMON_CONFIG, resolveDaemonConfig, type DaemonConfig } from './daemon-config.js';

export const DAEMON_DIRS = {
  threads: 'threads',
} as const;

/**
 * File name for one conversation. Thread ids are generated with `randomUUID`,
 * so this only has to refuse anything that is not one — a value that reached
 * the store from elsewhere must never be able to name a path.
 */
export function threadFileName(threadId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(threadId) || threadId === '.' || threadId === '..') {
    throw new Error(`unsafe thread id: ${threadId}`);
  }
  return `${threadId}.json`;
}

export const DAEMON_FILES = {
  config: 'daemon-config.json',
  status: 'bridge-status.json',
  pairing: 'pairing-session.json',
  pairingCode: 'pairing-code.json',
  trustedPhones: 'trusted-phones.json',
  managedWorktrees: 'managed-worktrees.json',
  pushState: 'push-state.json',
  lock: 'bridge.lock',
  checkpoints: 'checkpoints.json',
  threads: 'threads.json',
  updateCheck: 'update-check.json',
  metrics: 'metrics.json',
} as const;

/**
 * Backoff for {@link renameWithRetry}, in ms. Worst case ~410ms before giving up.
 */
const RENAME_RETRY_DELAYS_MS = [5, 15, 40, 100, 250];

/**
 * `rename` over an EXISTING file fails intermittently on Windows with `EPERM`
 * (also `EBUSY`/`EACCES`) when anything holds a transient handle on the target —
 * antivirus, the Search indexer, a backup agent, or the handle we just closed
 * ourselves. POSIX `rename` has no such window, which is why this only ever bit
 * on Windows. The write is fine; only the swap is momentarily refused, so a
 * short retry turns a spurious failure into a successful write.
 *
 * This matters far beyond a flaky test: `ThreadStore` persists every streamed
 * turn through {@link DaemonState.writeJson}, and `AgentManager` swallows event
 * handling errors. A single refused rename on the `turn_completed` write left
 * the turn stuck at `streaming` forever — the phone sat on "responding…" until
 * the app was killed, and the bridge test suite hung for its full 120s `waitFor`
 * budget (the long-standing "Windows CI flake").
 *
 * `doRename` is injectable so the retry policy can be unit-tested without
 * provoking a real EPERM (the ESM namespace object can't be monkey-patched).
 */
export async function renameWithRetry(
  from: string,
  to: string,
  doRename: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await doRename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!transient || delay === undefined) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export class DaemonState {
  readonly baseDir: string;

  constructor(baseDir: string = join(homedir(), '.uxnan')) {
    this.baseDir = baseDir;
  }

  get logsDir(): string {
    return join(this.baseDir, 'logs');
  }

  pathFor(file: string): string {
    return join(this.baseDir, file);
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
  }

  async readJson<T>(file: string): Promise<T | null> {
    try {
      const raw = await readFile(this.pathFor(file), 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Atomically write JSON: write to a temp sibling, then rename over the target. */
  async writeJson(file: string, data: unknown): Promise<void> {
    await this.ensureDir();
    const target = this.pathFor(file);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    try {
      await renameWithRetry(tmp, target);
    } catch (err) {
      // Never leave a temp sibling behind next to the real state file.
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Directory holding one file per conversation (`threads/<id>.json`).
   *
   * Conversations live one-per-file rather than in a single `threads.json`
   * because that file is rewritten on **every streamed token**: at 8.4 MB the
   * read+serialize+write round trip measured 93 ms per delta, which throttled
   * the agent's reply to a quarter of its natural speed and made it arrive in
   * lurches. Per thread the same write is a few KB.
   */
  get threadsDir(): string {
    return join(this.baseDir, DAEMON_DIRS.threads);
  }

  /**
   * Reads every stored conversation. Order is not meaningful — the caller sorts.
   * A file that is unreadable or not valid JSON is skipped rather than failing
   * the whole load: one damaged conversation must not cost the user the rest.
   */
  async readThreadFiles<T>(): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.threadsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: T[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await readFile(join(this.threadsDir, name), 'utf-8')) as T);
      } catch {
        continue;
      }
    }
    return out;
  }

  /** Atomically writes one conversation's file. */
  async writeThreadFile(threadId: string, data: unknown): Promise<void> {
    await mkdir(this.threadsDir, { recursive: true });
    const target = join(this.threadsDir, threadFileName(threadId));
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf-8');
    try {
      await renameWithRetry(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /** Removes one conversation's file. Missing is success. */
  async removeThreadFile(threadId: string): Promise<void> {
    await rm(join(this.threadsDir, threadFileName(threadId)), { force: true });
  }

  /**
   * Retires the legacy single-file store once its conversations have been
   * written out one per file. Renamed rather than deleted: until the new files
   * have proven themselves this is the user's only copy of their history.
   */
  async retireLegacyThreads(): Promise<void> {
    const from = this.pathFor(DAEMON_FILES.threads);
    await rename(from, `${from}.migrated`).catch(() => undefined);
  }

  async readConfig(): Promise<DaemonConfig> {
    const partial = await this.readJson<Partial<DaemonConfig>>(DAEMON_FILES.config);
    return resolveDaemonConfig(partial);
  }

  async writeConfig(config: DaemonConfig): Promise<void> {
    await this.writeJson(DAEMON_FILES.config, config);
  }

  /** Write the default config if none exists yet; returns the effective config. */
  async initConfig(): Promise<DaemonConfig> {
    const existing = await this.readJson<Partial<DaemonConfig>>(DAEMON_FILES.config);
    if (existing) return resolveDaemonConfig(existing);
    // Persist the seed WITHOUT the built-in `agents` model lists. Freezing them
    // here is what stopped new app versions from ever adding models to an
    // existing install — the seeded lists are a live baseline unioned in at read
    // time (see `mergeAgentModels`), so they must not be written to disk.
    const { agents: _seededAgents, ...withoutAgents } = DEFAULT_DAEMON_CONFIG;
    await this.writeJson(DAEMON_FILES.config, withoutAgents);
    return DEFAULT_DAEMON_CONFIG;
  }
}
