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
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DEFAULT_DAEMON_CONFIG, resolveDaemonConfig, type DaemonConfig } from './daemon-config.js';

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
