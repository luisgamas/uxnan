/**
 * Minimal JSON-RPC 2.0 client over newline-delimited stdio, used to talk to
 * `codex app-server`.
 *
 * Why a custom client (no deps): the bridge already has a one-line
 * `createInterface({ input })` reader per adapter and only needs request
 * correlation, server-request routing, and clean shutdown. The protocol
 * surface is small and stable.
 *
 * Lifecycle:
 *   const proc = spawn(...);
 *   const rpc = new CodexAppServerRpc(proc, handlers);
 *   await rpc.request('initialize', { ... });           // request → response
 *   rpc.onNotification((notif) => { ... });              // one-way server→client
 *   rpc.onServerRequest(async (method, params, id) => …)// server requests a reply
 *   await rpc.close();                                   // graceful shutdown
 *
 * Resilience:
 *  - A pending request is rejected when the process closes (so callers can fail
 *    fast instead of hanging on a 60s timeout).
 *  - A default per-request timeout (60s) catches hung requests; model listing
 *    uses its own shorter timeout because it's known to be fast.
 *  - Late responses (after the caller already moved on) are dropped, not
 *    surfaced.
 */
import { createInterface, type Interface as RL } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export type RpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: RpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponseSuccess {
  jsonrpc: '2.0';
  id: RpcId;
  result: unknown;
}

export interface JsonRpcResponseError {
  jsonrpc: '2.0';
  id: RpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcResponseSuccess | JsonRpcResponseError;

/** A one-way notification from the server (no `id`, no reply expected). */
export type ServerNotificationHandler = (method: string, params: unknown) => void;

/**
 * A server-initiated REQUEST (has `id` + `method`) — we MUST reply. The handler
 * returns the `result` payload (or throws an `RpcError`, see below).
 */
export type ServerRequestHandler = (
  method: string,
  params: unknown,
) => Promise<unknown> | unknown;

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  method: string;
}

export interface CodexAppServerRpcOptions {
  /** Per-request timeout in ms (default 60s). Pass 0 to disable. */
  requestTimeoutMs?: number;
  /** Extra `id` offset so multiple clients in the same process don't collide. */
  idStart?: number;
}

/**
 * Thin NDJSON JSON-RPC 2.0 client bound to a single child process's stdio.
 * Not thread-safe; intended for use from a single async context (one adapter).
 */
export class CodexAppServerRpc {
  readonly #stdin: Writable;
  readonly #stdout: Readable;
  readonly #requestTimeoutMs: number;
  readonly #reader: RL;
  readonly #pending = new Map<RpcId, PendingRequest>();
  readonly #onNotification: ServerNotificationHandler;
  readonly #onServerRequest: ServerRequestHandler;
  #nextId: number;
  /** Closed by `close()` or an EOF on stdout — rejects pending requests. */
  #closed = false;
  #onClose: ((code: number | null) => void) | undefined;

  constructor(
    streams: { stdin: Writable; stdout: Readable; onClose?: (code: number | null) => void },
    handlers: { onNotification: ServerNotificationHandler; onServerRequest: ServerRequestHandler },
    options: CodexAppServerRpcOptions = {},
  ) {
    this.#stdin = streams.stdin;
    this.#stdout = streams.stdout;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.#nextId = options.idStart ?? 1;
    this.#onNotification = handlers.onNotification;
    this.#onServerRequest = handlers.onServerRequest;
    this.#onClose = streams.onClose;
    this.#reader = createInterface({ input: this.#stdout, crlfDelay: Infinity });
    this.#reader.on('line', (line) => {
      void this.#handleLine(line);
    });
  }

  /** Send a request and await the server's response. Throws on timeout / error. */
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new Error('rpc: client is closed'));
    }
    const id = this.#nextId++;
    const effectiveTimeout = timeoutMs ?? this.#requestTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const entry: PendingRequest = {
        resolve: (v) => resolve(v as T),
        reject,
        timer: undefined,
        method,
      };
      if (effectiveTimeout > 0) {
        entry.timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(
            new RpcError(-32010, `rpc: request '${method}' (id=${id}) timed out after ${effectiveTimeout}ms`),
          );
        }, effectiveTimeout);
      }
      this.#pending.set(id, entry);
      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
      try {
        this.#stdin.write(`${JSON.stringify(msg)}\n`);
      } catch (err) {
        clearTimeout(entry.timer);
        this.#pending.delete(id);
        reject(err);
      }
    });
  }

  /** Send a one-way notification (no `id`, no reply). */
  notify(method: string, params?: unknown): void {
    if (this.#closed) return;
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
    try {
      this.#stdin.write(`${JSON.stringify(msg)}\n`);
    } catch {
      /* pipe closed mid-flight; onClose handler will fire */
    }
  }

  /** Send a reply to a server-initiated request. */
  reply(id: RpcId, result: unknown): void {
    this.#write({ jsonrpc: '2.0', id, result });
  }

  /** Send an error reply to a server-initiated request. */
  replyError(id: RpcId, code: number, message: string, data?: unknown): void {
    this.#write({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
  }

  /** Reject every pending request and stop reading. Idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [, entry] of this.#pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error('rpc: client closed'));
    }
    this.#pending.clear();
    try {
      this.#reader.close();
    } catch {
      /* already closed */
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Called by the owner when the child process emits `close`. */
  onProcessClose(code: number | null): void {
    this.#onClose?.(code);
  }

  #write(msg: object): void {
    if (this.#closed) return;
    try {
      this.#stdin.write(`${JSON.stringify(msg)}\n`);
    } catch {
      /* pipe closed */
    }
  }

  async #handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    // Response (has `id`, no `method`) → resolve a pending request.
    if (parsed['id'] !== undefined && parsed['method'] === undefined) {
      const id = parsed['id'] as RpcId;
      const entry = this.#pending.get(id);
      if (!entry) return; // late response
      this.#pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      if (isRecord(parsed['error'])) {
        const errObj = parsed['error'] as Record<string, unknown>;
        entry.reject(
          new RpcError(
            typeof errObj['code'] === 'number' ? (errObj['code'] as number) : -32000,
            typeof errObj['message'] === 'string' ? (errObj['message'] as string) : 'rpc error',
            errObj['data'],
          ),
        );
      } else {
        entry.resolve(parsed['result']);
      }
      return;
    }
    // Server request (has both `id` and `method`) → must reply.
    if (parsed['id'] !== undefined && typeof parsed['method'] === 'string') {
      const id = parsed['id'] as RpcId;
      const method = parsed['method'];
      const params = parsed['params'];
      try {
        const result = await this.#onServerRequest(method, params);
        this.reply(id, result ?? null);
      } catch (err) {
        if (err instanceof RpcError) {
          this.replyError(id, err.code, err.message, err.data);
        } else {
          this.replyError(
            id,
            -32000,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      return;
    }
    // Notification (has `method`, no `id`) → one-way.
    if (parsed['method'] === undefined) return;
    this.#onNotification(parsed['method'] as string, parsed['params']);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
