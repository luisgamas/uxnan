/**
 * Connects the bridge to the relay as the `mac` role for a given session, so a
 * phone connecting with the same `x-session-id` is paired and its E2EE frames
 * are forwarded here. Relay headers per architecture/02a §5.10.1.
 */
import { WebSocket } from 'ws';
import type { MessageIO } from './message-io.js';
import { wsToMessageIO } from './ws-adapter.js';

export interface ConnectRelayOptions {
  relayUrl: string;
  sessionId: string;
  macDeviceId: string;
  macIdentityPublicKey: string;
  machineName: string;
}

export interface RelayConnection {
  ws: WebSocket;
  io: MessageIO;
}

export function connectRelayAsMac(options: ConnectRelayOptions): Promise<RelayConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(options.relayUrl, {
      headers: {
        'x-role': 'mac',
        'x-session-id': options.sessionId,
        'x-mac-device-id': options.macDeviceId,
        'x-mac-identity-public-key': options.macIdentityPublicKey,
        'x-machine-name': options.machineName,
      },
    });
    const onError = (err: Error): void => reject(err);
    ws.once('error', onError);
    ws.once('open', () => {
      ws.removeListener('error', onError);
      resolve({ ws, io: wsToMessageIO(ws) });
    });
  });
}
