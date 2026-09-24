/**
 * The part of driving `opencode serve` both OpenCode versions share: the
 * process, its URL, its password, an SSE subscription and JSON requests.
 * Each version (`opencode-v1.ts`, `opencode-v2.ts`) owns only its routes and
 * how it reads its events.
 *
 *  - One `opencode serve --port <free> --hostname 127.0.0.1` process per adapter
 *    working directory, spawned lazily, on a port the bridge picked free — not
 *    `--port 0`: every OpenCode 1 release checked (1.17.20 – 1.18.32) ignores a
 *    zero and binds its default 4096, so a second project's server (or anything
 *    else on 4096) died with "exited before listening". The real URL is still
 *    parsed from the `listening on http://127.0.0.1:<port>` line.
 *  - Bound to loopback. OpenCode 2 refuses to serve without a password, so the
 *    bridge makes one per process (`OPENCODE_SERVER_PASSWORD`) and sends it as
 *    Basic auth (`opencode:<password>`); OpenCode 1 needs none.
 *  - The event subscription is awaited before `start()` resolves: the bus only
 *    delivers what happens after a client connects, so a turn started earlier
 *    would lose its events.
 *
 * Prompts travel in JSON bodies and the process is spawned `shell:false`, so
 * there is no command-injection surface.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/** How long to wait for `opencode serve` to print its listening URL. */
const SERVE_STARTUP_TIMEOUT_MS = 15_000;

/** A loopback port free right now (the OS picks it; the probe releases it). */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/** Extract `http://host:port` from an `opencode serve` startup line. */
export function parseServeUrl(line: string): string | undefined {
  const match = line.match(/listening on (https?:\/\/[^\s]+)/i);
  return match?.[1];
}

/**
 * The JSON payload of one SSE record (the text between two `\n\n` boundaries),
 * or null when it carries no `data:` or isn't JSON. Multi-line `data:` fields
 * join with a newline, per the SSE spec. A payload that is itself a JSON string
 * holding an object (how OpenCode 2 encodes its events) is decoded once more.
 */
export function parseSseData(record: string): Record<string, unknown> | null {
  const dataLines: string[] = [];
  for (const raw of record.split(/\r?\n/)) {
    if (raw.startsWith('data:')) dataLines.push(raw.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join('\n'));
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

export interface ServeProcessOptions {
  binaryPath: string;
  cwd: string;
  /** The event-stream path (`/event`, `/api/event`). */
  eventPath: string;
  /** Protect the server with a generated password (OpenCode 2 requires one). */
  password: boolean;
  /** Extra arguments after `serve --port <port> --hostname 127.0.0.1`. */
  extraArgs?: string[];
  /** Spawns the process (injected in tests; the default runs it `shell:false`). */
  spawnFn?: SpawnFn;
}

/** A running `opencode serve`, with its event stream and a JSON client. */
export class ServeProcess {
  readonly #opts: ServeProcessOptions;
  readonly #password: string | undefined;
  readonly #listeners = new Set<(data: Record<string, unknown>) => void>();
  readonly #closeListeners = new Set<() => void>();
  #child: SpawnedProcess | undefined;
  #baseUrl: string | undefined;
  #abort: AbortController | undefined;
  #startPromise: Promise<void> | undefined;
  #closed = false;

  constructor(opts: ServeProcessOptions) {
    this.#opts = opts;
    this.#password = opts.password ? randomBytes(24).toString('base64url') : undefined;
  }

  /** Spawn and connect the event stream. Idempotent; a failed start can be retried. */
  start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = (async () => {
      this.#baseUrl = await this.#spawn(await freeLoopbackPort());
      await this.#openEventStream();
    })().catch((err: unknown) => {
      this.#startPromise = undefined;
      throw err;
    });
    return this.#startPromise;
  }

  /** Receive every event payload (the decoded `data:` object). */
  onData(listener: (data: Record<string, unknown>) => void): void {
    this.#listeners.add(listener);
  }

  /** The process went away on its own. */
  onClose(listener: () => void): void {
    this.#closeListeners.add(listener);
  }

  close(): void {
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
  }

  /**
   * Send a JSON request and return the parsed body (`{}` when empty). Throws on a
   * non-2xx status, naming the path and status.
   */
  async request<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.#baseUrl) throw new Error('opencode server not started');
    const res = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...this.#authHeader(),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`opencode ${method} ${path} -> ${res.status}`);
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  #authHeader(): Record<string, string> {
    if (!this.#password) return {};
    const token = Buffer.from(`opencode:${this.#password}`).toString('base64');
    return { authorization: `Basic ${token}` };
  }

  #spawn(port: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let child: SpawnedProcess;
      try {
        child = (this.#opts.spawnFn ?? defaultSpawn)(
          this.#opts.binaryPath,
          [
            'serve',
            '--port',
            String(port),
            '--hostname',
            '127.0.0.1',
            ...(this.#opts.extraArgs ?? []),
          ],
          this.#opts.cwd,
          this.#password ? { env: { OPENCODE_SERVER_PASSWORD: this.#password } } : undefined,
        );
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
   * Open the long-lived SSE subscription. Resolves once the response arrives
   * (the subscription is live server-side) and rejects if it cannot connect; the
   * read loop keeps running afterwards.
   */
  #openEventStream(): Promise<void> {
    const abort = new AbortController();
    this.#abort = abort;
    const url = `${this.#baseUrl}${this.#opts.eventPath}`;
    return new Promise<void>((resolveConnected, rejectConnected) => {
      void (async () => {
        try {
          const res = await fetch(url, {
            signal: abort.signal,
            headers: { accept: 'text/event-stream', ...this.#authHeader() },
          });
          const body = res.body;
          if (!res.ok || !body)
            throw new Error(`opencode ${this.#opts.eventPath} -> ${res.status}`);
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
              const data = parseSseData(record);
              if (data) for (const listener of this.#listeners) listener(data);
            }
          }
        } catch (err) {
          // Rejecting after resolving is a no-op: a mid-stream drop (or the abort
          // on close) never reaches the caller; only a failure to connect does.
          rejectConnected(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
  }

  #handleClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) listener();
  }
}
