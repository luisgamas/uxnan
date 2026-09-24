/**
 * Local control channel (architecture/02a §5.8.15): a WebSocket listener bound
 * to **loopback only** that lets a client on this machine — Uxnan Desktop —
 * call the same JSON-RPC router the phones use and receive the same `stream/*`
 * notifications, without the E2EE pairing a phone needs.
 *
 * Why no E2EE here: the pairing handshake exists for a phone on the far side of
 * a network nobody controls. On loopback it removes no threat that the
 * owner-only permissions on the discovery file do not already cover, which is
 * the trust model `POST /agent-hook/approval` has always used.
 *
 * Every connection is authorized BEFORE the upgrade completes:
 *  - the peer must be a loopback address (the listener is bound to `127.0.0.1`
 *    anyway; this is defense in depth against a misconfigured bind);
 *  - the request must carry no `Origin` header — a browser always sends one on
 *    a WebSocket upgrade, a native client does not, so a web page can never
 *    reach this socket even if it guessed the token;
 *  - `Authorization: Bearer <token>` must match, compared in constant time.
 *
 * Once accepted, the client is registered in the {@link SessionRegistry} under
 * `local:<client>`, exactly like one more phone: it gets its own outbound log
 * and `seq`, every broadcast reaches it, and a reconnect replays what it missed
 * (or says it can't, with `hello.gap`).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  LOCAL_CONTROL_MAX_FRAME_BYTES,
  LOCAL_CONTROL_PATH,
  LOCAL_CONTROL_PROTOCOL,
  isValidLocalClientId,
  localReceiverId,
  type JsonRpcResponse,
  type LocalControlHelloFrame,
  type LocalControlMessageFrame,
} from '@uxnan/shared';
import { constantTimeEqual } from './constant-time.js';
import type { SessionRegistry, SessionSink } from './session-registry.js';
import { rawDataToBuffer } from './ws-adapter.js';

/**
 * A connection whose socket buffers more than this many bytes unsent is too
 * slow to keep up; it is closed and will resync on reconnect. The retained
 * outbound log is what makes that safe — nothing is lost, only re-fetched.
 */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

export interface LocalControlServerOptions {
  /** Port to bind on `127.0.0.1`; `0` picks a free one. */
  port: number;
  /** The bearer token a client must present. */
  token: string;
  /** Bridge package version, reported in the `hello` frame. */
  bridgeVersion: string;
  /** This bridge run's id; a client from another run is told to resync. */
  instanceId: string;
  registry: SessionRegistry;
  /** Dispatch one untrusted JSON-RPC request (the shared router). */
  dispatch: (raw: unknown, clientId: string) => Promise<JsonRpcResponse>;
  /** A client connected (after its replay). */
  onClientConnected?: (clientId: string) => void;
  /** A client's connection closed. */
  onClientDisconnected?: (clientId: string) => void;
}

export interface LocalControlServerHandle {
  readonly port: number;
  /** Client ids with a live connection right now. */
  connectedClients(): string[];
  close(): Promise<void>;
}

/** Where the connect query says the client stands. */
interface ConnectRequest {
  clientId: string;
  resume: number;
  instance: string | undefined;
}

/**
 * Start the listener. Resolves once it is bound, with the actual port.
 * Never listens on anything but `127.0.0.1`.
 */
export function startLocalControlServer(
  options: LocalControlServerOptions,
): Promise<LocalControlServerHandle> {
  const httpServer: Server = createServer((_req, res) => {
    // Only the WebSocket upgrade is served; there is no plain-HTTP surface.
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: LOCAL_CONTROL_MAX_FRAME_BYTES });
  /** receiverId → the live socket, so a second connection supersedes the first. */
  const live = new Map<string, WebSocket>();

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const rejection = authorize(req, options.token);
    if (rejection !== undefined) {
      refuse(socket, rejection);
      return;
    }
    const connect = parseConnect(req);
    if (!connect) {
      refuse(socket, 400);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      serveConnection(ws, connect, options, live);
    });
  });

  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(options.port, '127.0.0.1', () => {
      httpServer.removeListener('error', onError);
      const address = httpServer.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        port,
        connectedClients: () =>
          [...live.keys()].map((receiverId) => receiverId.slice('local:'.length)),
        close: () =>
          new Promise<void>((done) => {
            for (const ws of live.values()) ws.close(1001, 'bridge stopping');
            live.clear();
            wss.close(() => httpServer.close(() => done()));
          }),
      });
    });
  });
}

/**
 * Checks everything that must hold before a socket is accepted. Returns the
 * HTTP status to refuse with, or `undefined` when the request is authorized.
 */
export function authorize(req: IncomingMessage, token: string): number | undefined {
  if (!isLoopback(req.socket.remoteAddress)) return 403;
  // A browser always sends Origin on a WebSocket upgrade; a native client does
  // not. Refusing it keeps every web page off this socket.
  if (req.headers.origin !== undefined) return 403;
  const url = parseUrl(req);
  if (!url || url.pathname !== LOCAL_CONTROL_PATH) return 404;
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return 401;
  if (!constantTimeEqual(header.slice('Bearer '.length), token)) return 401;
  return undefined;
}

function parseConnect(req: IncomingMessage): ConnectRequest | undefined {
  const url = parseUrl(req);
  if (!url) return undefined;
  const clientId = url.searchParams.get('client') ?? '';
  if (!isValidLocalClientId(clientId)) return undefined;
  const resumeRaw = url.searchParams.get('resume');
  const resume = resumeRaw === null ? 0 : Number(resumeRaw);
  if (!Number.isSafeInteger(resume) || resume < 0) return undefined;
  const instance = url.searchParams.get('instance') ?? undefined;
  return { clientId, resume, instance: instance && instance.length > 0 ? instance : undefined };
}

function parseUrl(req: IncomingMessage): URL | undefined {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1');
  } catch {
    return undefined;
  }
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function refuse(socket: Duplex, status: number): void {
  const reason =
    status === 401
      ? 'Unauthorized'
      : status === 403
        ? 'Forbidden'
        : status === 404
          ? 'Not Found'
          : 'Bad Request';
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * What a reconnecting client can be given back. Replay is only meaningful
 * within one bridge run (the log does not survive a restart), so a client from
 * another run gets nothing replayed and `gap: true` — unless it never had
 * anything (`resume` 0), in which case there is nothing to be missing.
 */
export function planReplay(
  log: { entriesAfter(seq: number): { seq: number; plaintext: Buffer }[]; oldestSeq: number },
  connect: { resume: number; instance: string | undefined },
  instanceId: string,
): { entries: { seq: number; plaintext: Buffer }[]; gap: boolean } {
  if (connect.resume === 0) return { entries: [], gap: false };
  if (connect.instance !== instanceId) return { entries: [], gap: true };
  const entries = log.entriesAfter(connect.resume);
  // Everything up to `resume` was applied; the next one it needs is resume+1.
  // If the window already evicted it, what it missed is unrecoverable.
  const gap = connect.resume + 1 < log.oldestSeq;
  return { entries, gap };
}

function serveConnection(
  ws: WebSocket,
  connect: ConnectRequest,
  options: LocalControlServerOptions,
  live: Map<string, WebSocket>,
): void {
  const receiverId = localReceiverId(connect.clientId);
  // One live connection per client name: a newer one supersedes the older,
  // which is what a desktop that restarted (or reconnected before noticing the
  // old socket died) needs.
  const previous = live.get(receiverId);
  if (previous) previous.close(4000, 'superseded');
  live.set(receiverId, ws);

  const sendFrame = (frame: LocalControlHelloFrame | LocalControlMessageFrame): void => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      ws.close(1013, 'client too slow');
      return;
    }
    ws.send(JSON.stringify(frame));
  };

  const log = options.registry.logFor(receiverId);
  const replay = planReplay(log, connect, options.instanceId);
  sendFrame({
    type: 'hello',
    protocol: LOCAL_CONTROL_PROTOCOL,
    bridgeVersion: options.bridgeVersion,
    instanceId: options.instanceId,
    clientId: connect.clientId,
    replayed: replay.entries.length,
    gap: replay.gap,
  });
  for (const entry of replay.entries) {
    sendFrame({ type: 'message', seq: entry.seq, message: parsePlaintext(entry.plaintext) });
  }

  // Registered synchronously after the replay, so the backlog precedes any new
  // traffic — the same ordering rule the phone's catch-up follows.
  const sink: SessionSink = {
    send: (message) => {
      const seq = log.record(Buffer.from(JSON.stringify(message), 'utf-8'));
      sendFrame({ type: 'message', seq, message });
    },
  };
  options.registry.register(receiverId, sink);
  options.onClientConnected?.(connect.clientId);

  const lanes = new RequestLanes();
  ws.on('message', (data: RawData) => {
    const request = parseJson(rawDataToBuffer(data));
    lanes.run(laneKey(request), async () => {
      const response = await options.dispatch(request, connect.clientId);
      // A JSON-RPC notification (a method with no id) gets no reply; anything
      // else — including garbage, which the router answers with an error —
      // does.
      if (!isNotification(request)) sendFrame({ type: 'message', message: response });
    });
  });
  ws.on('close', () => {
    if (live.get(receiverId) === ws) live.delete(receiverId);
    // Keep the outbound log (the client resumes from it); drop only the sink,
    // and only if a newer connection has not already replaced it.
    if (options.registry.unregister(receiverId, sink)) {
      options.onClientDisconnected?.(connect.clientId);
    }
  });
  ws.on('error', () => {
    /* surfaced as 'close' */
  });
}

/**
 * Requests on one thread run in the order they arrived; everything else runs
 * concurrently. Two messages typed quickly must reach the thread's queue in the
 * order they were sent, but a slow `agent/models` (it may spawn a CLI) must not
 * hold up a `turn/list` on an unrelated thread.
 */
export class RequestLanes {
  readonly #tails = new Map<string, Promise<void>>();

  run(key: string | undefined, task: () => Promise<void>): void {
    const guarded = (): Promise<void> => task().catch(() => undefined);
    if (key === undefined) {
      void guarded();
      return;
    }
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const next = previous.then(guarded);
    this.#tails.set(key, next);
    void next.then(() => {
      if (this.#tails.get(key) === next) this.#tails.delete(key);
    });
  }
}

/** The ordering lane of a request: its `params.threadId`, when it names one. */
export function laneKey(request: unknown): string | undefined {
  if (!request || typeof request !== 'object') return undefined;
  const params = (request as { params?: unknown }).params;
  if (!params || typeof params !== 'object') return undefined;
  const threadId = (params as { threadId?: unknown }).threadId;
  return typeof threadId === 'string' && threadId.length > 0 ? `thread:${threadId}` : undefined;
}

function isNotification(request: unknown): boolean {
  return !!request && typeof request === 'object' && 'method' in request && !('id' in request);
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf-8'));
  } catch {
    return null;
  }
}

function parsePlaintext(bytes: Buffer): unknown {
  return parseJson(bytes);
}
