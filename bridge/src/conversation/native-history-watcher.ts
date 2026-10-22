/**
 * Native-history convergence (architecture/02a §5.8.8): the one place that
 * merges what an agent's own transcript holds into the bridge's store and
 * tells the clients it did.
 *
 * Two callers share one path ({@link NativeHistoryWatcher.reconcile}):
 *
 * - `turn/list`, before it pages a thread nobody is driving, and
 * - a loop over the threads clients are looking at, so a turn written in the
 *   agent's app or terminal reaches an open conversation without any client
 *   polling for it.
 *
 * A merge that changed the stored turns is announced as
 * `stream/history/changed { threadId, rev }`; every client showing that
 * conversation re-reads its newest page.
 *
 * What a client looks at is kept as interest: a `turn/list` marks its thread
 * watched by the client that read it. A reader's interest ends
 * {@link HISTORY_INTEREST_MS} after its last read, or as soon as it is no
 * longer connected; a thread with no reader left is not watched. With nothing
 * watched no timer is armed, so the loop costs nothing.
 */
import { JsonRpcErrorCode, RpcError, type HistoryChangedParams } from '@uxnan/shared';
import type { SessionHistoryReader } from './session-history.js';
import type { ThreadStore } from './thread-store.js';

/** How often a watched thread's transcript is checked (one `stat` each). */
export const HISTORY_WATCH_INTERVAL_MS = 2_000;

/**
 * How often a watched history that is not one file is read — OpenCode's,
 * through its server: nothing cheaper than reading it says whether it changed.
 */
export const HISTORY_UNSIGNED_INTERVAL_MS = 10_000;

/** How long one read keeps a thread watched for the client that read it. */
export const HISTORY_INTEREST_MS = 15 * 60_000;

/** The timer functions the loop uses (injected by tests). */
export interface WatcherTimers {
  setTimeout(callback: () => unknown, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface NativeHistoryWatcherOptions {
  threadStore: Pick<
    ThreadStore,
    'getHistorySource' | 'nativeHistoryCurrent' | 'reconcileNativeHistory'
  >;
  sessionHistory: Pick<SessionHistoryReader, 'sourceSignature' | 'readTurns'>;
  /** The turn the bridge is driving on a thread now, if any. */
  activeTurnId(threadId: string): string | undefined;
  /** Whether the client a read came from (its session registry id) is still connected. */
  isConnected(readerId: string): boolean;
  /** Broadcast `stream/history/changed`. */
  announce(params: HistoryChangedParams): void;
  now(): number;
  timers?: WatcherTimers;
  intervalMs?: number;
  unsignedIntervalMs?: number;
  interestMs?: number;
}

const realTimers: WatcherTimers = {
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    // A short-lived CLI command that starts a bridge must not be kept alive by it.
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class NativeHistoryWatcher {
  readonly #options: NativeHistoryWatcherOptions;
  readonly #timers: WatcherTimers;
  readonly #intervalMs: number;
  readonly #unsignedIntervalMs: number;
  readonly #interestMs: number;
  /** Watched threads → each reader's last read (epoch ms). */
  readonly #interest = new Map<string, Map<string, number>>();
  /** When a watched history that is not one file was last read. */
  readonly #unsignedReadAt = new Map<string, number>();
  /** The merge running now for a thread, which a second caller joins. */
  readonly #running = new Map<string, Promise<boolean>>();
  #started = false;
  #timer: unknown;
  #tick: Promise<void> | undefined;

  constructor(options: NativeHistoryWatcherOptions) {
    this.#options = options;
    this.#timers = options.timers ?? realTimers;
    this.#intervalMs = options.intervalMs ?? HISTORY_WATCH_INTERVAL_MS;
    this.#unsignedIntervalMs = options.unsignedIntervalMs ?? HISTORY_UNSIGNED_INTERVAL_MS;
    this.#interestMs = options.interestMs ?? HISTORY_INTEREST_MS;
  }

  /** Start watching (with the daemon). Nothing runs until a thread is watched. */
  start(): void {
    this.#started = true;
    this.#arm();
  }

  /** Stop watching (with the daemon): no tick runs after this resolves. */
  async stop(): Promise<void> {
    this.#started = false;
    if (this.#timer !== undefined) {
      this.#timers.clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#tick;
  }

  /** Thread ids watched now (for tests and status). */
  watched(): string[] {
    return [...this.#interest.keys()];
  }

  /** [readerId] (a session registry id) just read [threadId]: watch it for them. */
  watch(threadId: string, readerId: string): void {
    let readers = this.#interest.get(threadId);
    if (!readers) {
      readers = new Map();
      this.#interest.set(threadId, readers);
    }
    readers.set(readerId, this.#options.now());
    this.#arm();
  }

  /**
   * Merge the agent's transcript into [threadId] if it changed since the last
   * merge, and announce it when the stored turns changed. Never while the
   * bridge drives a turn on the thread: its own store is authoritative then,
   * and a half-written transcript record must not be taken for an external
   * turn. Says whether anything changed. Throws what the store throws (an
   * unknown thread).
   */
  reconcile(threadId: string): Promise<boolean> {
    return this.#once(threadId, () => this.#merge(threadId, false));
  }

  #once(threadId: string, run: () => Promise<boolean>): Promise<boolean> {
    const running = this.#running.get(threadId);
    if (running) return running;
    const merge = run().finally(() => this.#running.delete(threadId));
    this.#running.set(threadId, merge);
    return merge;
  }

  async #merge(threadId: string, polling: boolean): Promise<boolean> {
    const { threadStore, sessionHistory } = this.#options;
    if (this.#options.activeTurnId(threadId) !== undefined) return false;
    const source = await threadStore.getHistorySource(threadId);
    // No agent session yet: there is no transcript to read.
    if (source.agentId === undefined || source.agentSessionId === undefined) return false;
    const signature = await sessionHistory.sourceSignature(source);
    if (await threadStore.nativeHistoryCurrent(threadId, signature)) return false;
    if (signature === undefined) {
      const now = this.#options.now();
      const last = this.#unsignedReadAt.get(threadId);
      if (polling && last !== undefined && now - last < this.#unsignedIntervalMs) return false;
      this.#unsignedReadAt.set(threadId, now);
    }
    const nativeTurns = await sessionHistory.readTurns(source, threadId);
    // A turn may have started while the transcript was read.
    if (this.#options.activeTurnId(threadId) !== undefined) return false;
    // Nothing read and nothing to remember it by: no merge can change anything.
    if (nativeTurns === null && signature === undefined) return false;
    const result = await threadStore.reconcileNativeHistory(
      threadId,
      nativeTurns ?? [],
      this.#options.now(),
      signature,
    );
    if (result.changed && result.rev !== undefined) {
      this.#options.announce({ threadId, rev: result.rev });
    }
    return result.changed;
  }

  /** Schedule the next tick, if watching and anything is watched. */
  #arm(): void {
    if (!this.#started || this.#timer !== undefined || this.#tick !== undefined) return;
    if (this.#interest.size === 0) return;
    this.#timer = this.#timers.setTimeout(() => this.#runTick(), this.#intervalMs);
  }

  /** One tick, then the next is scheduled from its end — ticks never overlap. */
  #runTick(): Promise<void> {
    this.#timer = undefined;
    const tick = this.#checkWatched().finally(() => {
      this.#tick = undefined;
      this.#arm();
    });
    this.#tick = tick;
    return tick;
  }

  async #checkWatched(): Promise<void> {
    this.#forgetStale();
    for (const threadId of [...this.#interest.keys()]) {
      if (!this.#started) return;
      try {
        await this.#once(threadId, () => this.#merge(threadId, true));
      } catch (err) {
        // One thread's failure never stops the loop. A thread that is gone is
        // not watched any more; anything else is tried again next tick.
        if (err instanceof RpcError && err.code === JsonRpcErrorCode.ResourceNotFound) {
          this.#forget(threadId);
        }
      }
    }
  }

  /** Drop readers whose interest expired or who are no longer connected. */
  #forgetStale(): void {
    const now = this.#options.now();
    for (const [threadId, readers] of this.#interest) {
      for (const [readerId, readAt] of readers) {
        if (now - readAt >= this.#interestMs || !this.#options.isConnected(readerId)) {
          readers.delete(readerId);
        }
      }
      if (readers.size === 0) this.#forget(threadId);
    }
  }

  #forget(threadId: string): void {
    this.#interest.delete(threadId);
    this.#unsignedReadAt.delete(threadId);
  }
}
