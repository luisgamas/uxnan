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
  /**
   * CSWSH defense — explicit allowlist of `Origin` header values accepted on
   * WebSocket upgrades. When set, an upgrade with an `Origin` header that
   * doesn't match any entry is rejected (mismatch = potential browser
   * cross-site WebSocket hijack). When unset (default), the relay still
   * defends against the most common case — `Origin` whose host does not match
   * the `Host` header — and accepts Origin-less upgrades (Node `ws` clients
   * don't send Origin). Operators behind a tunnel/proxy that mangles the Host
   * header should set this to their public origin(s).
   */
  allowedOrigins?: string[];
}

export interface RelayServerHandle {
  port: number;
  close(): Promise<void>;
}

/**
 * Fixed-window per-key rate limiter, bounded against unbounded key growth.
 *
 * Keying by source IP (`ipOf`) means an attacker rotating addresses — trivial
 * over an allocated IPv6 /64 — would otherwise grow `#windows` by one entry
 * per new address forever, turning an anti-abuse control into a memory sink.
 * `allow` therefore sweeps expired windows on every new-window insert and
 * enforces a hard `maxKeys` cap (oldest entry evicted first) as a backstop
 * against a burst of still-unexpired keys. Neither bound changes the budget
 * for any single key: a legitimate, unrotated client is throttled exactly as
 * before.
 */
export class RateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();
  readonly #limit: number;
  readonly #now: () => number;
  readonly #windowMs: number;
  readonly #maxKeys: number;

  constructor(limit: number, now: () => number, windowMs = 60_000, maxKeys = 10_000) {
    this.#limit = limit;
    this.#now = now;
    this.#windowMs = windowMs;
    this.#maxKeys = maxKeys;
  }

  /** Number of keys currently tracked (bounded by `maxKeys`); exposed for tests. */
  get size(): number {
    return this.#windows.size;
  }

  allow(key: string): boolean {
    const now = this.#now();
    const existing = this.#windows.get(key);
    if (!existing || now - existing.start >= this.#windowMs) {
      this.#sweep(now);
      this.#evictIfFull(key);
      this.#windows.set(key, { start: now, count: 1 });
      return true;
    }
    existing.count += 1;
    return existing.count <= this.#limit;
  }

  /** Drop windows that have already expired — bounds the common case. */
  #sweep(now: number): void {
    for (const [k, w] of this.#windows) {
      if (now - w.start >= this.#windowMs) this.#windows.delete(k);
    }
  }

  /**
   * Hard backstop against a burst of still-unexpired keys (e.g. rapid IP
   * rotation within a single window): evict the oldest-inserted entry once at
   * capacity. `Map` preserves insertion order, so the first key is the oldest.
   */
  #evictIfFull(nextKey: string): void {
    if (this.#windows.size < this.#maxKeys || this.#windows.has(nextKey)) return;
    const oldest = this.#windows.keys().next().value;
    if (oldest !== undefined) this.#windows.delete(oldest);
  }
}

export class RelayServer {
  readonly #sessions = new Map<string, SessionPeers>();
  readonly #logger: RelayLogger;
  readonly #httpLimiter: RateLimiter;
  readonly #upgradeLimiter: RateLimiter;
  readonly #pushRegistry: PushRegistry;
  readonly #allowedOrigins: string[] | undefined;
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
    this.#allowedOrigins = options.allowedOrigins;
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
      // CSWSH defense: a browser-initiated upgrade carries `Origin`; an
      // attacker page can use that to open a WS against the relay and have
      // the user's cookies / session ride the channel. Reject Origin values
      // that don't match the allowed set (explicit allowlist) or, when no
      // allowlist is configured, the request's own Host header (covers the
      // common self-hosted case: Origin = Host means same origin). Origin-less
      // upgrades (Node `ws` clients, server-to-server) are accepted.
      if (!isAllowedOrigin(req, this.#allowedOrigins)) {
        this.#logger.warn(`upgrade rejected: bad origin "${req.headers['origin'] ?? ''}"`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
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
    const superseded = peers[role];
    peers[role] = ws;
    this.#sessions.set(sessionId, peers);
    this.#logger.info(`socket joined: role=${role} session=${sessionId}`);

    // A new socket for this role REPLACES an older one that never delivered a
    // close — e.g. the phone reconnected after a background drop while its old,
    // now half-open, socket still lingers (no FIN ever arrived). That stale
    // socket's eventual close is ignored by the guard in the `close` handler
    // below (it is no longer the current socket for its role), so its teardown
    // must happen HERE, at supersession time: close the superseded socket AND
    // its paired peer, so the paired side re-establishes a fresh session.
    //
    // This is critical for the bridge: it serves exactly one phone session per
    // `mac` socket and only re-arms its handshake when that socket closes (see
    // the bridge's `connectRelay` serve loop). Without this teardown a
    // reconnecting phone's handshake is forwarded into the bridge's stale,
    // still-running session loop — which treats the handshake frame as invalid
    // encrypted traffic and drops it — leaving the phone stuck "reconnecting"
    // until the app is force-killed (only then does its current socket close
    // cleanly and free the session).
    if (superseded && superseded !== ws) {
      const peer = role === 'mac' ? peers.iphone : peers.mac;
      closeQuietly(superseded);
      if (peer && peer !== ws) {
        if (role === 'mac') delete peers.iphone;
        else delete peers.mac;
        closeQuietly(peer);
      }
      this.#logger.info(`socket superseded: role=${role} session=${sessionId}`);
    }

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
      // If a newer socket already replaced us for this role (e.g. the bridge
      // reconnected with the same sessionId), this is a stale close: do NOT
      // tear down the peer, or we'd kill a freshly reconnected phone's handshake
      // ("message channel closed").
      if (current[role] !== ws) return;
      delete current[role];
      // Tear down the paired peer so it learns the other side is gone instead of
      // sitting on a half-open socket. This lets the phone detect a dead bridge
      // (and trigger reconnect) instead of showing "connected" forever.
      const peer = role === 'mac' ? current.iphone : current.mac;
      if (peer && peer.readyState === peer.OPEN) peer.close();
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

/** Close a socket, swallowing any error (it may already be closing/dead). */
function closeQuietly(ws: WebSocket): void {
  try {
    ws.close();
  } catch {
    /* already closing or closed */
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * CSWSH defense for WebSocket upgrades. When `allowedOrigins` is configured,
 * the upgrade's `Origin` header (if present) must match one of those values.
 * Otherwise (the default), a same-origin check — `Origin`'s host must equal
 * the request's `Host` header — is applied. Origin-less upgrades (server-to-
 * server `ws` clients) are always accepted.
 */
function isAllowedOrigin(req: IncomingMessage, allowedOrigins: string[] | undefined): boolean {
  const origin = header(req, 'origin');
  if (!origin) return true; // server-to-server client; no Origin header.
  if (allowedOrigins && allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin);
  }
  // Default defense: reject cross-origin browser upgrades. We compare hosts
  // (host + port) so a self-hosted relay over a tunnel is naturally allowed
  // (the browser sends Origin == Host == the public hostname).
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // malformed Origin → reject.
  }
  return originHost === header(req, 'host');
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
