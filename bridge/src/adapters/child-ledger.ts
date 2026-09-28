/**
 * The record of every agent process the running bridge has started
 * (`~/.uxnan/agent-processes.json`), so the next bridge can end the ones a
 * killed bridge left behind.
 *
 * A graceful stop closes every child (`AgentManager.stopAll`). A bridge killed
 * hard — `SIGKILL`, `launchctl kickstart -k`, a crash, an OOM kill — cannot, and
 * its long-lived children (an `opencode serve`, a resident `pi`/`agy`, Codex's
 * app-server, an ACP server) are re-parented to init and keep running with
 * nobody to talk to. This file is what the bridge that starts next reads to
 * find them: {@link reapOrphanedChildren} (`orphan-reaper.ts`) ends each one
 * that is still running, orphaned and still running the recorded command.
 *
 * One writer: only the long-running daemon, after it holds the single-instance
 * lock, installs a ledger (`recordChildrenIn`, `spawn.ts`); every agent process
 * starts through `spawn.ts`, which adds it here and removes it on exit. Short
 * commands and tests never install one, so they never write this file.
 */
import type { DaemonState } from '../daemon-state.js';
import { DAEMON_FILES } from '../daemon-state.js';

/** File-format version of {@link ChildLedgerFile}. */
export const CHILD_LEDGER_VERSION = 1;

/** One process the bridge started, as recorded on disk. */
export interface ChildRecord {
  /** The child's pid. */
  pid: number;
  /** The executable it was started with, exactly as passed to `spawn`. */
  command: string;
  /** Its arguments, exactly as passed to `spawn`. */
  args: string[];
  /** Its working directory. */
  cwd: string;
  /** Epoch ms at which the bridge started it. */
  startedAt: number;
  /** The pid of the bridge that started it. */
  ownerPid: number;
  /** Epoch ms at which that bridge started — the owner's start marker. */
  ownerStartedAt: number;
}

/** `agent-processes.json`. */
export interface ChildLedgerFile {
  version: number;
  processes: ChildRecord[];
}

/** What a spawn site reports about a child it just started. */
export interface ChildStart {
  pid: number;
  command: string;
  args: readonly string[];
  cwd: string;
}

export interface ChildLedgerOptions {
  /** This bridge's pid (default `process.pid`). */
  ownerPid?: number;
  /** This bridge's start, epoch ms (default: now). */
  ownerStartedAt?: number;
  /** Clock (epoch ms), for tests. */
  now?: () => number;
  /** Told when a write fails; the record is best-effort and never throws. */
  onError?: (err: unknown) => void;
}

/**
 * Reads the record a previous bridge left. A missing, unreadable or malformed
 * file is an empty record — never an error: at worst an orphan is left running,
 * which is where the bridge stood before this record existed. Malformed rows
 * are dropped one by one.
 */
export async function readChildLedger(state: DaemonState): Promise<ChildRecord[]> {
  let raw: unknown;
  try {
    raw = await state.readJson<unknown>(DAEMON_FILES.agentProcesses);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== 'object') return [];
  const processes = (raw as { processes?: unknown }).processes;
  if (!Array.isArray(processes)) return [];
  return processes.filter(isChildRecord);
}

function isChildRecord(value: unknown): value is ChildRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const isPid = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0;
  return (
    isPid(r['pid']) &&
    isPid(r['ownerPid']) &&
    typeof r['command'] === 'string' &&
    r['command'].length > 0 &&
    Array.isArray(r['args']) &&
    r['args'].every((a) => typeof a === 'string') &&
    typeof r['cwd'] === 'string' &&
    typeof r['startedAt'] === 'number' &&
    typeof r['ownerStartedAt'] === 'number'
  );
}

/**
 * The live record of this bridge's children. {@link add} and {@link remove}
 * are synchronous (they are called from `spawn` and a child's `exit`); the file
 * follows in the background, one write at a time, always of the newest state.
 */
export class ChildLedger {
  readonly #state: DaemonState;
  readonly #ownerPid: number;
  readonly #ownerStartedAt: number;
  readonly #now: () => number;
  readonly #onError: (err: unknown) => void;
  readonly #children = new Map<number, ChildRecord>();
  #dirty = false;
  #writing: Promise<void> | undefined;

  constructor(state: DaemonState, options: ChildLedgerOptions = {}) {
    this.#state = state;
    this.#now = options.now ?? (() => Date.now());
    this.#ownerPid = options.ownerPid ?? process.pid;
    this.#ownerStartedAt = options.ownerStartedAt ?? this.#now();
    this.#onError = options.onError ?? (() => undefined);
  }

  /** Records a child that just started. */
  add(child: ChildStart): void {
    this.#children.set(child.pid, {
      pid: child.pid,
      command: child.command,
      args: [...child.args],
      cwd: child.cwd,
      startedAt: this.#now(),
      ownerPid: this.#ownerPid,
      ownerStartedAt: this.#ownerStartedAt,
    });
    this.#schedule();
  }

  /** Forgets a child that exited. */
  remove(pid: number): void {
    if (this.#children.delete(pid)) this.#schedule();
  }

  /** The children recorded now. */
  get records(): ChildRecord[] {
    return [...this.#children.values()];
  }

  /** Resolves once the file holds the current state. */
  async flush(): Promise<void> {
    while (this.#writing) await this.#writing;
  }

  /** Writes the (empty) record now, replacing whatever a previous bridge left. */
  reset(): Promise<void> {
    this.#children.clear();
    this.#schedule();
    return this.flush();
  }

  #schedule(): void {
    this.#dirty = true;
    this.#writing ??= this.#drain();
  }

  async #drain(): Promise<void> {
    try {
      while (this.#dirty) {
        this.#dirty = false;
        const file: ChildLedgerFile = { version: CHILD_LEDGER_VERSION, processes: this.records };
        try {
          await this.#state.writeJson(DAEMON_FILES.agentProcesses, file);
        } catch (err) {
          this.#onError(err);
        }
      }
    } finally {
      // Same tick as the last `#dirty` check: a change made after it starts a
      // new drain instead of waiting on this finished one.
      this.#writing = undefined;
    }
  }
}
