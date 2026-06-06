/**
 * Direct-LAN WebSocket server. The phone may connect here without the relay
 * (architecture/02a §5.9.3); the E2EE semantics are identical.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { MessageIO } from './message-io.js';
import { wsToMessageIO } from './ws-adapter.js';

export interface LanServerOptions {
  port: number;
  host?: string;
  onConnection: (io: MessageIO) => void;
}

export interface LanServerHandle {
  port: number;
  close(): Promise<void>;
}

export function startLanServer(options: LanServerOptions): Promise<LanServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: options.port, host: options.host });
    const onError = (err: Error): void => reject(err);
    wss.once('error', onError);
    wss.once('listening', () => {
      wss.removeListener('error', onError);
      const address = wss.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => res());
          }),
      });
    });
    wss.on('connection', (ws: WebSocket) => options.onConnection(wsToMessageIO(ws)));
  });
}
