/**
 * HTTP + Server-Sent-Events client for a headless `opencode serve` process.
 *
 * Why a server (refactor of the old `opencode run --format json` adapter):
 * `opencode run` is one-shot and non-interactive — it runs tools autonomously
 * and only emits tool events *after* the tool ran, so the bridge could never
 * gate a sensitive action. `opencode serve` starts a long-lived local HTTP
 * server whose `/event` SSE bus surfaces `permission.asked` elicitations the
 * bridge routes to the phone's approval card (the same flow Codex's app-server
 * uses). This is the OpenCode analogue of `codex-app-server.ts`.
 *
 * ## Process + transport model
 *  - One `opencode serve --port 0 --hostname 127.0.0.1` process per adapter,
 *    spawned lazily on first use. `--port 0` lets the OS pick a free port; we
 *    parse the real port from the `listening on http://127.0.0.1:<port>` line.
 *  - Bound to loopback with no password: the bridge is the only local client,
 *    matching the posture of the other local agent CLIs (codex app-server over
 *    stdio). No `OPENCODE_SERVER_PASSWORD` is set.
 *  - A single long-lived subscription to `GET /event` (the global bus) is opened
 *    once; the adapter routes each event to the right thread by `sessionID`.
 *
 * The prompt is passed in a JSON body (never a shell argv), and the server exe
 * is spawned with `shell:false`, so there is no command-injection surface.
 */
import { spawn } from 'node:child_process';
import type { SpawnedProcess } from './spawn.js';

/** A reply to an OpenCode `permission.asked`: allow once, always, or reject. */
export type PermissionReply = 'once' | 'always' | 'reject';

/** One rule of a session's permission ruleset (`POST /session` `permission`). */
export interface OpenCodePermissionRule {
  /** Permission key (`edit`/`bash`/`webfetch`/`external_directory`/…). */
  permission: string;
  /** Glob the rule applies to (`**` = all). */
  pattern: string;
  /** `ask` surfaces an approval; `allow`/`deny` decide without prompting. */
  action: 'allow' | 'deny' | 'ask';
}

/** The prompt payload for `POST /session/{id}/prompt_async`. */
export interface OpenCodePromptBody {
  /** `{ providerID, modelID }` split from a `provider/model` id (optional). */
  model?: { providerID: string; modelID: string };
  /** Provider/model variant (OpenCode's reasoning knob), when set. */
  variant?: string;
  /** The user's turn text. */
  text: string;
}

/**
 * A parsed `/event` SSE payload. OpenCode events are `{ type, properties, … }`;
 * we keep the raw object and expose `type`/`properties` for the adapter.
 */
export interface OpenCodeServerEvent {
  type: string;
  properties: Record<string, unknown>;
}

/** The surface the OpenCode adapter drives (faked in tests via a serverFactory). */
export interface IOpenCodeServer {
  /** Spawn (if needed) + wait until the HTTP server + SSE stream are live. */
  start(): Promise<void>;
  /** Create a session, returning its `ses_…` id. */
  createSession(opts: { title?: string; permission?: OpenCodePermissionRule[] }): Promise<string>;
  /** Fire a turn (returns once accepted; results arrive via `onEvent`). */
  promptAsync(sessionId: string, body: OpenCodePromptBody): Promise<void>;
  /** Abort the in-flight turn of a session. */
  abort(sessionId: string): Promise<void>;
  /** Reply to a pending `permission.asked` by its `per_…` id. */
  replyPermission(permissionId: string, reply: PermissionReply): Promise<void>;
  /** Reject a pending `question.asked` by its request id (to unblock the turn). */
  rejectQuestion(requestId: string): Promise<void>;
  /**
   * Reply to a pending `question.asked` with the user's chosen answers — one
   * entry per question, each an array of selected option labels.
   */
  replyQuestion(requestId: string, answers: string[][]): Promise<void>;
  /** Subscribe to server events. Returns an unsubscribe function. */
  onEvent(listener: (event: OpenCodeServerEvent) => void): () => void;
  /** Register a callback for the server process exiting unexpectedly. */
  onClose(listener: () => void): void;
  /** Kill the process and stop the SSE stream. Idempotent. */
  close(): Promise<void>;
}

/**
 * Parse one SSE record (the text between two `\n\n` boundaries) into the event
 * object, or null if it carries no `data:` payload / isn't JSON. Exported for
 * unit tests; tolerant of multi-line `data:` fields per the SSE spec.
 */
export function parseSseRecord(record: string): OpenCodeServerEvent | null {
  const dataLines: string[] = [];
  for (const raw of record.split(/\r?\n/)) {
    if (raw.startsWith('data:')) dataLines.push(raw.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const type = typeof obj['type'] === 'string' ? (obj['type'] as string) : '';
  if (!type) return null;
  const properties =
    typeof obj['properties'] === 'object' && obj['properties'] !== null
      ? (obj['properties'] as Record<string, unknown>)
      : {};
  return { type, properties };
}

/** Extract `http://host:port` from an `opencode serve` startup log line. */
export function parseServeUrl(line: string): string | undefined {
  const match = line.match(/listening on (https?:\/\/[^\s]+)/i);
  return match?.[1];
}

/** How long to wait for `opencode serve` to print its listening URL. */
const SERVE_STARTUP_TIMEOUT_MS = 15_000;

/**
 * The production {@link IOpenCodeServer}: spawns `opencode serve` and speaks
 * HTTP + SSE to it. Tests inject a fake implementation of the interface instead.
 */
export class OpenCodeServer implements IOpenCodeServer {
  readonly #binaryPath: string;
  readonly #cwd: string;
  readonly #listeners = new Set<(event: OpenCodeServerEvent) => void>();
  readonly #closeListeners = new Set<() => void>();
  #child: SpawnedProcess | undefined;
  #baseUrl: string | undefined;
  #abort: AbortController | undefined;
  #startPromise: Promise<void> | undefined;
  #closed = false;

  constructor(binaryPath: string, cwd: string) {
    this.#binaryPath = binaryPath;
    this.#cwd = cwd;
  }

  start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = this.#spawnAndConnect().catch((err) => {
      this.#startPromise = undefined;
      throw err;
    });
    return this.#startPromise;
  }

  async #spawnAndConnect(): Promise<void> {
    const baseUrl = await this.#spawnServer();
    this.#baseUrl = baseUrl;
    // AWAIT the `/event` subscription being established before returning: the bus
    // only delivers events emitted AFTER we connect, so a turn started before the
    // stream is live would lose all its events (the "first turn shows nothing"
    // race). Once the fetch response is in, the subscription is registered
    // server-side and buffered events are safe to read.
    await this.#openEventStream(baseUrl);
  }

  /** Spawn `opencode serve` and resolve with its base URL once it's listening. */
  #spawnServer(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let child: SpawnedProcess;
      try {
        child = spawn(
          this.#binaryPath,
          ['serve', '--port', '0', '--hostname', '127.0.0.1', '--print-logs'],
          { cwd: this.#cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false },
        ) as unknown as SpawnedProcess;
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.#child = child;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('opencode serve did not report a listening URL in time'));
      }, SERVE_STARTUP_TIMEOUT_MS);

      const scan = (chunk: unknown): void => {
        if (settled) return;
        const url = parseServeUrl(String(chunk));
        if (url) {
          settled = true;
          clearTimeout(timer);
          resolve(url);
        }
      };
      child.stdout.on('data', scan);
      child.stderr?.on('data', scan);
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error('opencode serve exited before listening'));
        }
        this.#handleClose();
      });
    });
  }

  /**
   * Open the long-lived `/event` SSE subscription and fan events out. Returns a
   * promise that resolves once the HTTP response is received (the subscription is
   * live server-side) and rejects if the connection can't be opened — so the
   * caller can await a race-free "ready to prompt" point. The read loop keeps
   * running in the background after the promise settles.
   */
  #openEventStream(baseUrl: string): Promise<void> {
    const abort = new AbortController();
    this.#abort = abort;
    return new Promise<void>((resolveConnected, rejectConnected) => {
      void (async () => {
        try {
          const res = await fetch(`${baseUrl}/event`, {
            signal: abort.signal,
            headers: { accept: 'text/event-stream' },
          });
          const body = res.body;
          if (!res.ok || !body) throw new Error(`opencode /event -> ${res.status}`);
          // Subscription registered server-side; safe to create sessions / prompt.
          resolveConnected();
          const reader = body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const record = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const event = parseSseRecord(record);
              if (event) this.#dispatch(event);
            }
          }
        } catch (err) {
          // Rejecting after resolve is a no-op, so a mid-stream drop (or an abort
          // on close) doesn't affect the already-signalled connection; only a
          // failure to CONNECT surfaces to the caller.
          rejectConnected(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
  }

  #dispatch(event: OpenCodeServerEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #handleClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) listener();
  }

  createSession(opts: { title?: string; permission?: OpenCodePermissionRule[] }): Promise<string> {
    return this.#post<{ id: string }>('/session', {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.permission !== undefined ? { permission: opts.permission } : {}),
    }).then((res) => res.id);
  }

  async promptAsync(sessionId: string, body: OpenCodePromptBody): Promise<void> {
    await this.#post(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.variant !== undefined ? { variant: body.variant } : {}),
      parts: [{ type: 'text', text: body.text }],
    });
  }

  async abort(sessionId: string): Promise<void> {
    await this.#post(`/session/${encodeURIComponent(sessionId)}/abort`, undefined);
  }

  async replyPermission(permissionId: string, reply: PermissionReply): Promise<void> {
    await this.#post(`/permission/${encodeURIComponent(permissionId)}/reply`, { reply });
  }

  async rejectQuestion(requestId: string): Promise<void> {
    await this.#post(`/question/${encodeURIComponent(requestId)}/reject`, undefined);
  }

  async replyQuestion(requestId: string, answers: string[][]): Promise<void> {
    await this.#post(`/question/${encodeURIComponent(requestId)}/reply`, { answers });
  }

  onEvent(listener: (event: OpenCodeServerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  onClose(listener: () => void): void {
    this.#closeListeners.add(listener);
  }

  close(): Promise<void> {
    this.#closed = true;
    try {
      this.#abort?.abort();
    } catch {
      /* already aborted */
    }
    try {
      this.#child?.kill();
    } catch {
      /* already gone */
    }
    return Promise.resolve();
  }

  /** POST JSON to a server path and return the parsed JSON body (or `{}`). */
  async #post<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
    if (!this.#baseUrl) throw new Error('opencode server not started');
    const res = await fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`opencode ${path} -> ${res.status}`);
    }
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }
}
