/**
 * The revision counter behind replica sync (architecture/02a §5.8.17).
 *
 * Every change to shared state — a thread's summary, a project, the shared
 * settings — takes the next value of ONE global counter, and the change is
 * broadcast with it. A client that remembers the last revision it applied asks
 * `sync/changes { since }` and gets everything newer, so a notification it
 * missed (backgrounded, mid-reconnect, a bridge restart) can never leave it
 * behind: the phone and the desktop converge on the same list whatever they
 * happened to receive live.
 *
 * Persisted in `sync.json`: the counter must never go backwards across a
 * restart, or a client would skip a change that reused a number it had already
 * seen. The file also keeps the most recent deletions (tombstones) — an entity
 * that no longer exists cannot carry its own revision — bounded to
 * {@link MAX_TOMBSTONES}; a client asking for changes older than the oldest one
 * still kept gets a full snapshot instead (`reset`).
 *
 * `storeId` names this state directory. It changes only when `~/.uxnan` is
 * recreated, and then every client's remembered revision means nothing, so a
 * mismatch also forces a reset.
 */
import { randomUUID } from 'node:crypto';
import type { DaemonState } from '../daemon-state.js';

export type SyncEntityKind = 'thread' | 'project';

export interface Tombstone {
  kind: SyncEntityKind;
  id: string;
  rev: number;
}

interface LedgerFile {
  storeId: string;
  rev: number;
  /** The oldest revision still answerable incrementally (see {@link horizon}). */
  horizon: number;
  tombstones: Tombstone[];
  /** Revision of singleton state (e.g. `settings`), by name. */
  marks?: Record<string, number>;
}

/** Deletions remembered for incremental sync; older ones force a reset. */
export const MAX_TOMBSTONES = 2_000;

export const SYNC_LEDGER_FILE = 'sync.json';

export class SyncLedger {
  readonly #state: DaemonState | undefined;
  #storeId: string;
  #rev = 0;
  #horizon = 0;
  #tombstones: Tombstone[] = [];
  #marks: Record<string, number> = {};
  #dirty = false;
  #writing: Promise<void> = Promise.resolve();

  private constructor(state: DaemonState | undefined, storeId: string) {
    this.#state = state;
    this.#storeId = storeId;
  }

  /** A ledger kept only in memory (tests, and stores built without one). */
  static memory(): SyncLedger {
    return new SyncLedger(undefined, randomUUID());
  }

  /** Load the ledger from `sync.json`, creating it on first run. */
  static async load(state: DaemonState): Promise<SyncLedger> {
    const file = await state.readJson<LedgerFile>(SYNC_LEDGER_FILE);
    const ledger = new SyncLedger(state, file?.storeId ?? randomUUID());
    if (file) {
      ledger.#rev = Number.isSafeInteger(file.rev) ? file.rev : 0;
      ledger.#horizon = Number.isSafeInteger(file.horizon) ? file.horizon : 0;
      ledger.#tombstones = Array.isArray(file.tombstones) ? file.tombstones : [];
      ledger.#marks = file.marks && typeof file.marks === 'object' ? { ...file.marks } : {};
    } else {
      ledger.#dirty = true;
      await ledger.flush();
    }
    return ledger;
  }

  get storeId(): string {
    return this.#storeId;
  }

  /** The newest revision handed out. */
  get rev(): number {
    return this.#rev;
  }

  /**
   * Oldest `since` still answerable incrementally: a client whose revision is
   * below it may have missed a deletion that was already forgotten.
   */
  get horizon(): number {
    return this.#horizon;
  }

  /**
   * Make sure the counter is past a revision some entity already carries (read
   * back from disk). Protects the monotonic guarantee if `sync.json` was lost
   * or restored from an older copy while the entity files were not.
   */
  observe(rev: number | undefined): void {
    if (rev !== undefined && Number.isSafeInteger(rev) && rev > this.#rev) {
      this.#rev = rev;
      this.#dirty = true;
    }
  }

  /** The next revision. Call {@link flush} before announcing it. */
  next(): number {
    this.#rev += 1;
    this.#dirty = true;
    return this.#rev;
  }

  /** Record a deletion under a fresh revision and return that revision. */
  tombstone(kind: SyncEntityKind, id: string): number {
    const rev = this.next();
    this.#tombstones = this.#tombstones.filter((t) => !(t.kind === kind && t.id === id));
    this.#tombstones.push({ kind, id, rev });
    if (this.#tombstones.length > MAX_TOMBSTONES) {
      const dropped = this.#tombstones.splice(0, this.#tombstones.length - MAX_TOMBSTONES);
      this.#horizon = Math.max(this.#horizon, dropped[dropped.length - 1]!.rev);
    }
    return rev;
  }

  /** Forget a tombstone because the entity came back (same id re-created). */
  revive(kind: SyncEntityKind, id: string): void {
    const before = this.#tombstones.length;
    this.#tombstones = this.#tombstones.filter((t) => !(t.kind === kind && t.id === id));
    if (this.#tombstones.length !== before) this.#dirty = true;
  }

  /** Stamp singleton state [name] with a fresh revision and return it. */
  stamp(name: string): number {
    const rev = this.next();
    this.#marks[name] = rev;
    return rev;
  }

  /** The revision singleton state [name] last changed at (0 if never). */
  mark(name: string): number {
    return this.#marks[name] ?? 0;
  }

  /** Deletions of [kind] after [since]. */
  deletedSince(kind: SyncEntityKind, since: number): string[] {
    return this.#tombstones.filter((t) => t.kind === kind && t.rev > since).map((t) => t.id);
  }

  /**
   * Persist the counter if it moved. Serialized, so concurrent callers never
   * interleave writes; resolves once everything handed out so far is on disk.
   */
  flush(): Promise<void> {
    const state = this.#state;
    if (!state) {
      this.#dirty = false;
      return Promise.resolve();
    }
    // Chain on the previous write's settlement, not its success: one failed
    // write must not poison every flush after it.
    this.#writing = this.#writing
      .catch(() => undefined)
      .then(async () => {
        if (!this.#dirty) return;
        this.#dirty = false;
        const file: LedgerFile = {
          storeId: this.#storeId,
          rev: this.#rev,
          horizon: this.#horizon,
          tombstones: this.#tombstones,
          marks: this.#marks,
        };
        try {
          await state.writeJson(SYNC_LEDGER_FILE, file);
        } catch (err) {
          this.#dirty = true;
          throw err;
        }
      });
    return this.#writing;
  }
}
