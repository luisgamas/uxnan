/**
 * Persistent daemon state under `~/.uxnan/` (non-secret files only).
 *
 * Secrets (the Ed25519 private identity) live in a {@link SecretStore}, never in
 * these JSON files. Writes are atomic (temp file + rename), except a turn's
 * journal, which is only ever appended to.
 *
 * Source: architecture/02a-system-architecture.md §5.8.3.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Dirent } from 'node:fs';
import {
  appendFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DEFAULT_DAEMON_CONFIG, resolveDaemonConfig, type DaemonConfig } from './daemon-config.js';

export const DAEMON_DIRS = {
  threads: 'threads',
  /** Where each conversation file of the one-file-per-conversation layout goes
   *  once it was converted (see {@link DaemonState.retireV1ThreadFile}). */
  threadsV1: 'threads.v1',
  attachments: 'attachments',
} as const;

/** A path segment made only of safe characters, never `.` or `..`. */
function safeName(value: string, what: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`unsafe ${what}: ${value}`);
  }
  return value;
}

/**
 * The file stem a turn is stored under. Turns the bridge ran have UUIDs, used
 * as they are; a turn imported from an agent's transcript has the reader's id
 * (`<session>#t3`), which no file name may carry, so anything but letters,
 * digits and dashes is written as `_` + its base64url. A plain stem never
 * starts with `_`, so the two can never name the same file.
 */
export function turnFileStem(turnId: string): string {
  if (/^[A-Za-z0-9-]+$/.test(turnId)) return turnId;
  return `_${Buffer.from(turnId, 'utf-8').toString('base64url')}`;
}

export const DAEMON_FILES = {
  config: 'daemon-config.json',
  /** The secrets sealed with a key handed in at start (`--secret-key-stdin`). */
  sealedSecrets: 'secrets.sealed',
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
  // What the self-update helper left for the bridge that starts after it.
  updateResult: 'update-result.json',
  metrics: 'metrics.json',
  settingsDecided: 'settings-decided.json',
  // How the relay was set up (`relay/relay-service.ts`); its endpoint is a setting.
  relay: 'relay.json',
  // Every agent process the running bridge started (`adapters/child-ledger.ts`).
  agentProcesses: 'agent-processes.json',
  // The names the bridge gave the agents' own sessions that had none (`agents/session-titles.ts`).
  sessionTitles: 'session-titles.json',
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
 * This matters far beyond a flaky test: `ThreadStore` persists the end of every
 * turn through an atomic write, and `AgentManager` swallows event handling
 * errors. A single refused rename on the `turn_completed` write left
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
   * Directory holding the conversations, one directory each:
   *
   *     threads/<threadId>/thread.json              summary + turn index
   *     threads/<threadId>/turns/<turn>.json        one settled turn's messages
   *     threads/<threadId>/turns/<turn>.journal     the turn in flight, append-only
   *     threads/<threadId>/digest.json              text-only digest of its turns (search)
   *     threads/<threadId>/transfer.md              what a continuation carries over
   *
   * Why this shape, measured on real data: with one file per conversation a
   * 46 MB conversation was re-serialized and rewritten on every streamed token
   * (~100 ms each), and every start parsed all of them (207 MB, 512 MB of heap).
   * Split by turn, a start reads only the small `thread.json` files, a turn is
   * read when someone opens it, and a token appends one line to a journal.
   */
  get threadsDir(): string {
    return join(this.baseDir, DAEMON_DIRS.threads);
  }

  #threadDir(threadId: string): string {
    return join(this.threadsDir, safeName(threadId, 'thread id'));
  }

  #turnPath(threadId: string, turnId: string, ext: 'json' | 'journal'): string {
    return join(this.#threadDir(threadId), 'turns', `${turnFileStem(turnId)}.${ext}`);
  }

  /**
   * The `thread.json` of every stored conversation, as text (the store keeps it
   * to skip rewriting an index that did not change). Order is not meaningful. A
   * directory without a readable index is skipped rather than failing the whole
   * load: one damaged conversation must not cost the user the rest.
   */
  async readThreadIndexes(): Promise<{ threadId: string; text: string }[]> {
    const out: { threadId: string; text: string }[] = [];
    for (const entry of await readdirTyped(this.threadsDir)) {
      if (!entry.isDirectory()) continue;
      try {
        const text = await readFile(join(this.threadsDir, entry.name, 'thread.json'), 'utf-8');
        out.push({ threadId: entry.name, text });
      } catch {
        continue;
      }
    }
    return out;
  }

  /** Whether a conversation's index is on disk (its conversion finished). */
  async hasThreadIndex(threadId: string): Promise<boolean> {
    try {
      return (await stat(join(this.#threadDir(threadId), 'thread.json'))).isFile();
    } catch {
      return false;
    }
  }

  /** Atomically writes a conversation's `thread.json`. */
  async writeThreadIndex(threadId: string, text: string): Promise<void> {
    await atomicWrite(join(this.#threadDir(threadId), 'thread.json'), text);
  }

  /** A settled turn's file, as text; `null` when there is none. */
  readTurnFile(threadId: string, turnId: string): Promise<string | null> {
    return readOptional(this.#turnPath(threadId, turnId, 'json'));
  }

  /** Atomically writes a turn's file. */
  async writeTurnFile(threadId: string, turnId: string, text: string): Promise<void> {
    await atomicWrite(this.#turnPath(threadId, turnId, 'json'), text);
  }

  /** The journal of a turn, as text; `null` when it has none. */
  readTurnJournal(threadId: string, turnId: string): Promise<string | null> {
    return readOptional(this.#turnPath(threadId, turnId, 'journal'));
  }

  /**
   * Appends [text] to a turn's journal (creating it). Deliberately not atomic:
   * an append is the whole point — it costs what it writes — and a reader of the
   * journal ignores a last line a crash left half-written.
   */
  async appendTurnJournal(threadId: string, turnId: string, text: string): Promise<void> {
    const path = this.#turnPath(threadId, turnId, 'journal');
    await mkdir(join(path, '..'), { recursive: true });
    await appendFile(path, text, 'utf-8');
  }

  /** Removes a turn's journal (once folded into its file). Missing is success. */
  async removeTurnJournal(threadId: string, turnId: string): Promise<void> {
    await rm(this.#turnPath(threadId, turnId, 'journal'), { force: true });
  }

  /**
   * A conversation's `digest.json` — the small, text-only digest of each of
   * its settled turns that search scans and a continuation selects from
   * (`conversation/thread-digest.ts`); `null` when there is none yet.
   */
  readThreadDigest(threadId: string): Promise<string | null> {
    return readOptional(join(this.#threadDir(threadId), 'digest.json'));
  }

  /** Atomically writes a conversation's `digest.json`. */
  async writeThreadDigest(threadId: string, text: string): Promise<void> {
    await atomicWrite(join(this.#threadDir(threadId), 'digest.json'), text);
  }

  /**
   * The context a continuation carries over (`transfer.md`, written once when
   * it is made, read when its first message goes); `null` when there is none.
   */
  readTransferContext(threadId: string): Promise<string | null> {
    return readOptional(join(this.#threadDir(threadId), 'transfer.md'));
  }

  /** Atomically writes a continuation's `transfer.md`. */
  async writeTransferContext(threadId: string, text: string): Promise<void> {
    await atomicWrite(join(this.#threadDir(threadId), 'transfer.md'), text);
  }

  /** Removes a turn's file and journal. Missing is success. */
  async removeTurnFiles(threadId: string, turnId: string): Promise<void> {
    await rm(this.#turnPath(threadId, turnId, 'json'), { force: true });
    await rm(this.#turnPath(threadId, turnId, 'journal'), { force: true });
  }

  /**
   * Removes a conversation. Its index goes first: a crash halfway through then
   * leaves turn files nobody lists, never an index naming files that are gone.
   */
  async removeThread(threadId: string): Promise<void> {
    const dir = this.#threadDir(threadId);
    await rm(join(dir, 'thread.json'), { force: true });
    await rm(dir, { recursive: true, force: true });
  }

  /**
   * Conversations still in the previous layout, one `threads/<id>.json` file
   * each, waiting to be converted.
   */
  async v1ThreadIds(): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of await readdirTyped(this.threadsDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -'.json'.length);
      if (/^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..') ids.push(id);
    }
    return ids;
  }

  /** One conversation of the previous layout; `null` if unreadable. */
  async readV1ThreadFile<T>(threadId: string): Promise<T | null> {
    try {
      const path = join(this.threadsDir, `${safeName(threadId, 'thread id')}.json`);
      return JSON.parse(await readFile(path, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  /**
   * Moves a converted conversation file of the previous layout to
   * `threads.v1/<id>.json`. Moved rather than deleted — until the new layout has
   * proven itself it is the user's copy of that history — and out of `threads/`,
   * so it is never read again. It can be deleted by hand.
   */
  async retireV1ThreadFile(threadId: string): Promise<void> {
    const name = `${safeName(threadId, 'thread id')}.json`;
    const dir = join(this.baseDir, DAEMON_DIRS.threadsV1);
    await mkdir(dir, { recursive: true });
    await renameWithRetry(join(this.threadsDir, name), join(dir, name));
  }

  /** Removes a file of the state directory. Missing is success. */
  async remove(file: string): Promise<void> {
    await rm(this.pathFor(file), { force: true });
  }

  /**
   * Directory holding the images users attached to a conversation's messages
   * (`attachments/<threadId>/<file>`), kept beside the conversation so every
   * client can show them.
   */
  #attachmentsDir(threadId: string): string {
    return join(this.baseDir, DAEMON_DIRS.attachments, safeName(threadId, 'thread id'));
  }

  /** Writes one attachment of a conversation. */
  async writeAttachment(threadId: string, file: string, data: Buffer): Promise<void> {
    const dir = this.#attachmentsDir(threadId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, safeName(file, 'attachment')), data);
  }

  /** Reads one attachment of a conversation. */
  readAttachment(threadId: string, file: string): Promise<Buffer> {
    return readFile(join(this.#attachmentsDir(threadId), safeName(file, 'attachment')));
  }

  /** Copies a conversation's attachments to another (a fork keeps its images). */
  async copyAttachments(fromThreadId: string, toThreadId: string): Promise<void> {
    try {
      await cp(this.#attachmentsDir(fromThreadId), this.#attachmentsDir(toThreadId), {
        recursive: true,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  /** Removes every attachment of a conversation. Missing is success. */
  async removeAttachments(threadId: string): Promise<void> {
    await rm(this.#attachmentsDir(threadId), { recursive: true, force: true });
  }

  /**
   * Retires the oldest layout — every conversation in one `threads.json` — once
   * its conversations have been written out in the current one. Renamed (to
   * `threads.json.migrated`) rather than deleted: until the new files have
   * proven themselves this is the user's only copy of their history.
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
    await this.writeJson(DAEMON_FILES.config, DEFAULT_DAEMON_CONFIG);
    return DEFAULT_DAEMON_CONFIG;
  }
}

/** Writes [text] to [target] atomically: a temp sibling, then a rename over it. */
async function atomicWrite(target: string, text: string): Promise<void> {
  await mkdir(join(target, '..'), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, 'utf-8');
  try {
    await renameWithRetry(tmp, target);
  } catch (err) {
    // Never leave a temp sibling behind next to the real file.
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** A file's text, or `null` when it does not exist. */
async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** A directory's entries; none when it does not exist. */
async function readdirTyped(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
