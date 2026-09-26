/**
 * Single-instance lock for the daemon (`~/.uxnan/bridge.lock`).
 *
 * Prevents a standalone bridge and an embedded one (or two standalone daemons)
 * from running at once and fighting over the relay identity and LAN port
 * (architecture/02e-bridge-integration.md §7.3). A lock owned by a process that
 * is no longer alive is considered stale and may be taken over.
 */
import { readFile, unlink, writeFile } from 'node:fs/promises';

export interface LockInfo {
  pid: number;
  startedAt: number;
}

/** Whether a process with the given pid is currently alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH → no such process; EPERM → exists but not signalable (alive).
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class LockFile {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<LockInfo | null> {
    try {
      const raw = await readFile(this.#path, 'utf-8');
      return JSON.parse(raw) as LockInfo;
    } catch {
      return null; // missing or corrupt → treat as no lock
    }
  }

  /**
   * Try to acquire the lock. Returns `true` on success, or `false` if another
   * live process already holds it. Stale locks are overwritten.
   */
  async acquire(pid: number = process.pid, now: number = Date.now()): Promise<boolean> {
    const existing = await this.read();
    if (existing && existing.pid !== pid && isProcessAlive(existing.pid)) {
      return false;
    }
    await writeFile(this.#path, JSON.stringify({ pid, startedAt: now }), 'utf-8');
    return true;
  }

  /**
   * Hand the lock to another process — the self-update helper — while `from`
   * still holds it, so there is never a moment it is free for a second bridge
   * to take while npm replaces the package. Returns false (and changes
   * nothing) when `from` does not own it.
   */
  async transfer(
    to: number,
    from: number = process.pid,
    now: number = Date.now(),
  ): Promise<boolean> {
    const existing = await this.read();
    if (!existing || existing.pid !== from) return false;
    await writeFile(this.#path, JSON.stringify({ pid: to, startedAt: now }), 'utf-8');
    return true;
  }

  /** Release the lock if it is owned by `pid` (no-op otherwise). */
  async release(pid: number = process.pid): Promise<void> {
    const existing = await this.read();
    if (existing && existing.pid !== pid) return;
    try {
      await unlink(this.#path);
    } catch {
      // already gone
    }
  }
}
