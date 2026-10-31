/**
 * Naming the agents' own sessions (architecture/02a §5.8.19).
 *
 * `agent/sessions` lists what each CLI keeps, and a CLI keeps no title for some
 * sessions (OpenCode never names the ones it did not title, Codex has none for a
 * thread with no name or preview). The bridge names them the way it names its
 * own conversations — the same errand, `IAgentAdapter.generateTitle`, one layer
 * — from the session's first exchange, read from the agent's own history, and
 * keeps the answer.
 *
 * A listing must never wait for a model, so naming is lazy: `request` queues
 * the untitled sessions it is handed, the listing answers at once with what is
 * known (a title, or `titlePending`), and the client asks again a few seconds
 * later. It is bounded three ways, so a folder with fifty untitled sessions
 * never starts fifty agent runs: at most {@link TITLE_CONCURRENCY} at a time, a
 * queue of at most {@link TITLE_QUEUE_MAX} (the rest wait for the next listing),
 * and at most {@link TITLE_BUDGET_PER_HOUR} runs an hour.
 *
 * Titles are kept in a file of their own (`session-titles.json`), newest
 * {@link TITLE_KEPT_MAX}; a session that cannot be named — no readable history
 * (Antigravity), no user message yet, a failed run twice over — is not asked for
 * again until the bridge restarts (a failure) or {@link TITLE_RETRY_MS} passes
 * (nothing to read yet).
 */
import { isOneShotPrompt, type AgentId, type GenerateTitleOptions, type Turn } from '@uxnan/shared';
import { DAEMON_FILES } from '../daemon-state.js';
import type { Logger } from '../logger.js';
import type { HistorySource } from '../conversation/session-history.js';

/** Runs at once. Each is a one-shot of the agent's CLI. */
export const TITLE_CONCURRENCY = 2;
/** Sessions waiting for a run; a listing offers more once these are done. */
export const TITLE_QUEUE_MAX = 12;
/** Runs the bridge starts for this, per hour. */
export const TITLE_BUDGET_PER_HOUR = 30;
/** Tries a session gets before it is left untitled until a restart. */
export const TITLE_MAX_FAILURES = 2;
/** Titles kept on disk. */
export const TITLE_KEPT_MAX = 500;
/** How long a session with nothing to name from is left alone. */
export const TITLE_RETRY_MS = 10 * 60 * 1000;
/** The part of an exchange the model reads (the title prompt clips it further). */
const SOURCE_MAX_CHARS = 1_500;

/** One session to name: where its history lives. */
export interface SessionTitleRef {
  agentId: AgentId;
  sessionId: string;
  cwd: string;
  /** The model the session last ran on, when its record says (`NativeSessionInfo.model`). */
  model?: string;
}

export interface SessionTitlesOptions {
  /** The bridge's state directory, for the file the titles are kept in. */
  state: {
    readJson<T>(file: string): Promise<T | null>;
    writeJson(file: string, data: unknown): Promise<void>;
  };
  /** The agent's own history of a session (`SessionHistoryReader.readTurns`). */
  readTurns(source: HistorySource, threadId: string): Promise<Turn[] | null>;
  /** Name it: the agent's cheap one-shot (`AgentManager.generateSessionTitle`). */
  generate(agentId: AgentId, options: GenerateTitleOptions): Promise<string | undefined>;
  now(): number;
  logger: Logger;
  concurrency?: number;
  queueMax?: number;
  budgetPerHour?: number;
  retryMs?: number;
}

interface KeptTitle {
  title: string;
  /** When it was written, epoch ms. */
  at: number;
}

interface KeptFile {
  titles: Record<string, KeptTitle>;
}

function keyOf(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

export class SessionTitles {
  readonly #options: SessionTitlesOptions;
  readonly #kept = new Map<string, KeptTitle>();
  readonly #queue: (SessionTitleRef & { key: string })[] = [];
  /** Queued or running, by key. */
  readonly #pending = new Set<string>();
  readonly #failures = new Map<string, number>();
  /** Sessions whose first message is one of Uxnan's own errands (a leftover of a naming run). */
  readonly #errands = new Set<string>();
  /** Sessions with nothing to read yet, until this time. */
  readonly #nothingYet = new Map<string, number>();
  /** When each run of the last hour started. */
  #runs: number[] = [];
  #running = 0;
  #saving: Promise<void> = Promise.resolve();

  constructor(options: SessionTitlesOptions) {
    this.#options = options;
  }

  /** Load the titles kept on disk. */
  async init(): Promise<void> {
    const file = await this.#options.state.readJson<KeptFile>(DAEMON_FILES.sessionTitles);
    for (const [key, value] of Object.entries(file?.titles ?? {})) {
      if (typeof value?.title === 'string' && value.title.length > 0) {
        this.#kept.set(key, { title: value.title, at: Number(value.at) || 0 });
      }
    }
  }

  /** The name the bridge gave a session, if it has. */
  titleOf(agentId: string, sessionId: string): string | undefined {
    return this.#kept.get(keyOf(agentId, sessionId))?.title;
  }

  /**
   * Whether a session turned out to be one of Uxnan's own one-shots — what a
   * CLI left behind of a naming run it cannot run without a session — found by
   * reading its first message. Such a session is nobody's work: not listed.
   */
  isErrand(agentId: string, sessionId: string): boolean {
    return this.#errands.has(keyOf(agentId, sessionId));
  }

  /** Whether a name is on its way (queued or running). */
  isPending(agentId: string, sessionId: string): boolean {
    return this.#pending.has(keyOf(agentId, sessionId));
  }

  /**
   * Queue the sessions that have no title, newest first as handed in. Ones
   * already named, queued, given up on or with nothing to read yet are skipped;
   * what does not fit the queue waits for the next listing.
   */
  request(refs: readonly SessionTitleRef[]): void {
    const now = this.#options.now();
    const queueMax = this.#options.queueMax ?? TITLE_QUEUE_MAX;
    for (const ref of refs) {
      const key = keyOf(ref.agentId, ref.sessionId);
      if (this.#kept.has(key) || this.#pending.has(key) || this.#errands.has(key)) continue;
      if ((this.#failures.get(key) ?? 0) >= TITLE_MAX_FAILURES) continue;
      if ((this.#nothingYet.get(key) ?? 0) > now) continue;
      if (this.#queue.length >= queueMax) break;
      this.#queue.push({ ...ref, key });
      this.#pending.add(key);
    }
    this.#pump();
  }

  #pump(): void {
    const concurrency = this.#options.concurrency ?? TITLE_CONCURRENCY;
    while (this.#running < concurrency && this.#queue.length > 0) {
      if (!this.#withinBudget()) {
        // Over the hour's budget: the rest is not named now, and not pending.
        for (const dropped of this.#queue.splice(0)) this.#pending.delete(dropped.key);
        return;
      }
      const next = this.#queue.shift()!;
      this.#running += 1;
      void this.#name(next)
        .catch((err: unknown) => {
          this.#options.logger.warn(`could not name session ${next.key}: ${String(err)}`);
          this.#failures.set(next.key, (this.#failures.get(next.key) ?? 0) + 1);
        })
        .finally(() => {
          this.#running -= 1;
          this.#pending.delete(next.key);
          this.#pump();
        });
    }
  }

  #withinBudget(): boolean {
    const now = this.#options.now();
    this.#runs = this.#runs.filter((at) => now - at < 60 * 60 * 1000);
    return this.#runs.length < (this.#options.budgetPerHour ?? TITLE_BUDGET_PER_HOUR);
  }

  async #name(ref: SessionTitleRef & { key: string }): Promise<void> {
    const exchange = await this.#firstExchange(ref);
    if (!exchange) {
      this.#nothingYet.set(
        ref.key,
        this.#options.now() + (this.#options.retryMs ?? TITLE_RETRY_MS),
      );
      return;
    }
    if (isOneShotPrompt(exchange.user)) {
      this.#errands.add(ref.key);
      return;
    }
    this.#runs.push(this.#options.now());
    const title = await this.#options.generate(ref.agentId, {
      userText: exchange.user,
      ...(exchange.assistant ? { assistantText: exchange.assistant } : {}),
      cwd: ref.cwd,
      // An agent with no cheaper model to name with names on the one the
      // session already ran on, before its default (`generateTitle`).
      ...(ref.model !== undefined ? { model: ref.model } : {}),
    });
    if (!title) {
      this.#failures.set(ref.key, (this.#failures.get(ref.key) ?? 0) + 1);
      return;
    }
    this.#kept.set(ref.key, { title, at: this.#options.now() });
    await this.#save();
  }

  /** What the person asked first, and what the agent answered — from its own history. */
  async #firstExchange(
    ref: SessionTitleRef,
  ): Promise<{ user: string; assistant?: string } | undefined> {
    const turns = await this.#options.readTurns(
      { agentId: ref.agentId, agentSessionId: ref.sessionId, cwd: ref.cwd },
      keyOf(ref.agentId, ref.sessionId),
    );
    for (const turn of turns ?? []) {
      const user = textOf(turn, 'user');
      if (!user) continue;
      const assistant = textOf(turn, 'assistant');
      return { user, ...(assistant ? { assistant } : {}) };
    }
    return undefined;
  }

  /** Write the newest {@link TITLE_KEPT_MAX} titles, one write at a time. */
  #save(): Promise<void> {
    const write = async (): Promise<void> => {
      const newest = [...this.#kept.entries()]
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, TITLE_KEPT_MAX);
      this.#kept.clear();
      for (const [key, value] of newest) this.#kept.set(key, value);
      await this.#options.state.writeJson(DAEMON_FILES.sessionTitles, {
        titles: Object.fromEntries(newest),
      } satisfies KeptFile);
    };
    this.#saving = this.#saving.then(write, write);
    return this.#saving;
  }
}

function textOf(turn: Turn, role: 'user' | 'assistant'): string | undefined {
  for (const message of turn.messages) {
    if (message.role !== role || typeof message.content !== 'string') continue;
    const text = message.content.trim().replace(/\s+/g, ' ');
    if (text.length > 0) {
      return text.length > SOURCE_MAX_CHARS ? text.slice(0, SOURCE_MAX_CHARS) : text;
    }
  }
  return undefined;
}
