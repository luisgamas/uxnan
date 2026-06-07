/**
 * Uxnan relay — forwards opaque E2EE envelopes between a phone (`iphone`) and a
 * bridge (`mac`) that share a `sessionId`. The relay never sees plaintext.
 *
 * Routing model (Phase 2): one `mac` and one `iphone` socket are paired per
 * `sessionId` (from the `x-session-id` header or `?sessionId=` query). Both the
 * phone (`x-role: iphone`) and the bridge (`x-role: mac`) present the session id.
 *
 * NOTE: `mac` / `iphone` are protocol ROLE names, not operating systems. `mac`
 * is the PC/bridge side (Windows, macOS or Linux); `iphone` is the mobile app
 * side (Android or iOS). The names are fixed by the wire contract.
 *
 * Source: architecture/02a-system-architecture.md §5.10.
 *
 * FOR-DEV: add rate limiting, pairing-code resolution, multi-session `mac`
 * registration and the push endpoints (src/relay-server.ts) — see §5.10.1.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { PushNotifyRequest, PushPlatform } from '@uxnan/shared';
import { NoopPushSender, PushRegistry } from './push.js';

export type RelayRole = 'mac' | 'iphone';

const MAX_BODY_BYTES = 16 * 1024;

interface SessionPeers {
  mac?: WebSocket;
  iphone?: WebSocket;
}

export interface RelayLogger {
  info(message: string): void;
  warn(message: string): void;
}

const NOOP_LOGGER: RelayLogger = { info: () => {}, warn: () => {} };

/** Per-IP request budgets per minute (architecture/02a §5.10.1). */
export interface RelayRateLimits {
  httpPerMinute: number;
  upgradePerMinute: number;
}

const DEFAULT_RATE_LIMITS: RelayRateLimits = { httpPerMinute: 120, upgradePerMinute: 60 };

export interface RelayServerOptions {
  logger?: RelayLogger;
  rateLimits?: Partial<RelayRateLimits>;
  /** Injected clock (epoch ms) for testability. */
  now?: () => number;
  /** Push delivery registry; defaults to a noop-sender registry (no FCM creds). */
  pushRegistry?: PushRegistry;
}

export interface RelayServerHandle {
  port: number;
  close(): Promise<void>;
}

/** Fixed-window per-key rate limiter. */
class RateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();
  readonly #limit: number;
  readonly #now: () => number;
  readonly #windowMs: number;

  constructor(limit: number, now: () => number, windowMs = 60_000) {
    this.#limit = limit;
    this.#now = now;
    this.#windowMs = windowMs;
  }

  allow(key: string): boolean {
    const now = this.#now();
    const window = this.#windows.get(key);
    if (!window || now - window.start >= this.#windowMs) {
      this.#windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.#limit;
  }
}

export class RelayServer {
  readonly #sessions = new Map<string, SessionPeers>();
  readonly #logger: RelayLogger;
  readonly #httpLimiter: RateLimiter;
  readonly #upgradeLimiter: RateLimiter;
  readonly #pushRegistry: PushRegistry;
  #http: Server | undefined;
  #wss: WebSocketServer | undefined;

  constructor(options: RelayServerOptions = {}) {
    this.#logger = options.logger ?? NOOP_LOGGER;
    const limits = { ...DEFAULT_RATE_LIMITS, ...(options.rateLimits ?? {}) };
    const now = options.now ?? (() => Date.now());
    this.#httpLimiter = new RateLimiter(limits.httpPerMinute, now);
    this.#upgradeLimiter = new RateLimiter(limits.upgradePerMinute, now);
    this.#pushRegistry =
      options.pushRegistry ??
      new PushRegistry({ sender: new NoopPushSender(this.#logger), logger: this.#logger, now });
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  /** The push registry (token store + delivery), exposed for tests/wiring. */
  get pushRegistry(): PushRegistry {
    return this.#pushRegistry;
  }

  start(port = 0, host?: string): Promise<RelayServerHandle> {
    const http = createServer((req, res) => {
      if (!this.#httpLimiter.allow(ipOf(req.socket.remoteAddress))) {
        res.writeHead(429, { 'content-type': 'text/plain' });
        res.end('Too Many Requests');
        return;
      }
      const url = req.url ?? '';
      if (req.method === 'GET' && url.startsWith('/health')) {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.startsWith('/push/')) {
        void this.#handlePush(req, res, url);
        return;
      }
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('Upgrade Required');
    });
    const wss = new WebSocketServer({ noServer: true });

    http.on('upgrade', (req, socket, head) => {
      if (!this.#upgradeLimiter.allow(ipOf(req.socket.remoteAddress))) {
        socket.destroy();
        return;
      }
      const conn = parseConnection(req);
      if (!conn) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.#register(conn.role, conn.sessionId, ws));
    });

    this.#http = http;
    this.#wss = wss;

    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      http.once('error', onError);
      http.listen(port, host, () => {
        http.removeListener('error', onError);
        const address = http.address();
        const boundPort = typeof address === 'object' && address !== null ? address.port : port;
        resolve({ port: boundPort, close: () => this.#close() });
      });
    });
  }

  #register(role: RelayRole, sessionId: string, ws: WebSocket): void {
    const peers = this.#sessions.get(sessionId) ?? {};
    peers[role] = ws;
    this.#sessions.set(sessionId, peers);
    this.#logger.info(`socket joined: role=${role} session=${sessionId}`);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      const current = this.#sessions.get(sessionId);
      const peer = role === 'mac' ? current?.iphone : current?.mac;
      if (peer && peer.readyState === peer.OPEN) {
        peer.send(data, { binary: isBinary });
      }
    });

    ws.on('close', () => {
      const current = this.#sessions.get(sessionId);
      if (!current) return;
      if (current[role] === ws) delete current[role];
      if (!current.mac && !current.iphone) {
        this.#sessions.delete(sessionId);
      }
      this.#logger.info(`socket left: role=${role} session=${sessionId}`);
    });
  }

  /** Handle `POST /push/register` and `POST /push/notify`. */
  async #handlePush(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'invalid body' });
      return;
    }
    const data = (body ?? {}) as Record<string, unknown>;

    if (url.startsWith('/push/register')) {
      const sessionId = asString(data['sessionId']);
      const pushToken = asString(data['pushToken']);
      const platform = asPlatform(data['platform']);
      if (!sessionId || !pushToken || !platform) {
        sendJson(res, 400, { error: 'sessionId, pushToken and platform are required' });
        return;
      }
      const result = this.#pushRegistry.register(sessionId, pushToken, platform);
      this.#logger.info(`push register: session=${sessionId} platform=${platform}`);
      sendJson(res, 200, result);
      return;
    }

    if (url.startsWith('/push/notify')) {
      const notify = asNotifyRequest(data);
      if (!notify) {
        sendJson(res, 400, { error: 'invalid notify payload' });
        return;
      }
      const outcome = await this.#pushRegistry.notify(notify);
      sendJson(res, outcome.reason === 'unauthorized' ? 403 : 200, outcome);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  }

  #close(): Promise<void> {
    return new Promise((resolve) => {
      for (const peers of this.#sessions.values()) {
        peers.mac?.close();
        peers.iphone?.close();
      }
      this.#sessions.clear();
      const wss = this.#wss;
      const http = this.#http;
      const done = (): void => {
        if (http) http.close(() => resolve());
        else resolve();
      };
      if (wss) wss.close(done);
      else done();
    });
  }
}

function parseConnection(req: IncomingMessage): { role: RelayRole; sessionId: string } | null {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const role = (header(req, 'x-role') ?? url.searchParams.get('role') ?? '').toLowerCase();
  const sessionId = header(req, 'x-session-id') ?? url.searchParams.get('sessionId') ?? '';
  if ((role !== 'mac' && role !== 'iphone') || sessionId.length === 0) return null;
  return { role, sessionId };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function ipOf(remoteAddress: string | undefined): string {
  return remoteAddress ?? 'unknown';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Read a size-capped JSON request body. Rejects on overflow or invalid JSON. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {});
      } catch (err) {
        reject(err instanceof Error ? err : new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asPlatform(value: unknown): PushPlatform | undefined {
  return value === 'ios' || value === 'android' ? value : undefined;
}

function asNotifyRequest(data: Record<string, unknown>): PushNotifyRequest | undefined {
  const sessionId = asString(data['sessionId']);
  const notificationSecret = asString(data['notificationSecret']);
  const threadId = asString(data['threadId']);
  const turnId = asString(data['turnId']);
  const title = typeof data['title'] === 'string' ? data['title'] : undefined;
  const body = typeof data['body'] === 'string' ? data['body'] : undefined;
  if (
    !sessionId ||
    !notificationSecret ||
    !threadId ||
    !turnId ||
    title === undefined ||
    body === undefined
  ) {
    return undefined;
  }
  return { sessionId, notificationSecret, threadId, turnId, title, body };
}
