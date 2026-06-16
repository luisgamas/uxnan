/**
 * Direct-LAN server. The phone may connect here without the relay
 * (architecture/02a §5.9.3); the E2EE semantics are identical.
 *
 * It is an `http.Server` with a WebSocket server attached: WS upgrades carry the
 * E2EE session (the primary path), and a single plain-HTTP route —
 * `GET /pair/resolve?code=<code>` — backs manual-code pairing (the phone trades a
 * code shown on the PC for the pairing payload; see `pairing/pairing-code-service.ts`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { MessageIO } from './message-io.js';
import { wsToMessageIO } from './ws-adapter.js';

/** Result of a `/pair/resolve` lookup: an HTTP status + JSON body to return. */
export interface PairResolveResult {
  status: number;
  json: unknown;
}

export interface LanServerOptions {
  port: number;
  host?: string;
  onConnection: (io: MessageIO) => void;
  /**
   * Optional handler for `GET /pair/resolve?code=…` (manual-code pairing). Given
   * the submitted code and the client IP, returns the HTTP status + JSON body.
   * Omitted → the route 404s.
   */
  onPairResolve?: (code: string, ip: string) => PairResolveResult;
}

export interface LanServerHandle {
  port: number;
  close(): Promise<void>;
}

export function startLanServer(options: LanServerOptions): Promise<LanServerHandle> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer((req, res) => handleHttp(req, res, options));
    const wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (ws: WebSocket) => options.onConnection(wsToMessageIO(ws)));

    const onError = (err: Error): void => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(options.port, options.host, () => {
      httpServer.removeListener('error', onError);
      const address = httpServer.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => httpServer.close(() => res()));
          }),
      });
    });
  });
}

function handleHttp(req: IncomingMessage, res: ServerResponse, options: LanServerOptions): void {
  const send = (status: number, json: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  };
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    send(400, { error: 'bad_request' });
    return;
  }
  if (req.method !== 'GET' || url.pathname !== '/pair/resolve') {
    send(404, { error: 'not_found' });
    return;
  }
  if (!options.onPairResolve) {
    send(404, { error: 'pairing_disabled' });
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    send(400, { error: 'missing_code' });
    return;
  }
  const ip = req.socket.remoteAddress ?? 'unknown';
  const result = options.onPairResolve(code, ip);
  send(result.status, result.json);
}
