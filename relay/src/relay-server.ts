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
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

export type RelayRole = 'mac' | 'iphone';

interface SessionPeers {
  mac?: WebSocket;
  iphone?: WebSocket;
}

export interface RelayLogger {
  info(message: string): void;
  warn(message: string): void;
}

const NOOP_LOGGER: RelayLogger = { info: () => {}, warn: () => {} };

export interface RelayServerHandle {
  port: number;
  close(): Promise<void>;
}

export class RelayServer {
  readonly #sessions = new Map<string, SessionPeers>();
  readonly #logger: RelayLogger;
  #http: Server | undefined;
  #wss: WebSocketServer | undefined;

  constructor(logger: RelayLogger = NOOP_LOGGER) {
    this.#logger = logger;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  start(port = 0, host?: string): Promise<RelayServerHandle> {
    const http = createServer((req, res) => {
      if (req.method === 'GET' && (req.url ?? '').startsWith('/health')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('Upgrade Required');
    });
    const wss = new WebSocketServer({ noServer: true });

    http.on('upgrade', (req, socket, head) => {
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
