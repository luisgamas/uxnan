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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DEFAULT_DAEMON_CONFIG, resolveDaemonConfig, type DaemonConfig } from './daemon-config.js';

export const DAEMON_FILES = {
  config: 'daemon-config.json',
  status: 'bridge-status.json',
  pairing: 'pairing-session.json',
  trustedPhones: 'trusted-phones.json',
  managedWorktrees: 'managed-worktrees.json',
  pushState: 'push-state.json',
} as const;

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
    await rename(tmp, target);
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
    await this.writeConfig(DEFAULT_DAEMON_CONFIG);
    return DEFAULT_DAEMON_CONFIG;
  }
}
