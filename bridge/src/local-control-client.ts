/**
 * A one-shot client of the RUNNING bridge's local control channel
 * (architecture/02a §5.8.15), for CLI commands that must change the live
 * daemon rather than a file it read at startup — `uxnan-bridge config set`
 * goes through here so every connected phone and desktop hears the change,
 * and `uxnan-bridge qr` asks it for its own pairing payload.
 *
 * Connects as the local client `cli` (not `desktop`: it is not Uxnan Desktop
 * and must not appear as one), sends one request, and closes.
 */
import {
  LOCAL_CONTROL_FILE,
  LOCAL_CONTROL_PATH,
  makeRequest,
  validatePairingPayload,
  type LocalControlFrame,
  type PairingPayload,
} from '@uxnan/shared';
import WebSocket from 'ws';
import type { DaemonState } from './daemon-state.js';
import { readDiscoveryFile } from './local-control-discovery.js';

/** The local client id CLI commands connect as. */
export const CLI_LOCAL_CLIENT = 'cli';

const CALL_TIMEOUT_MS = 10_000;

/**
 * Call [method] on the running bridge. Resolves `undefined` when no bridge
 * serves the channel (nothing is running, or it runs without the channel);
 * rejects with the bridge's error message when the call itself failed.
 */
export async function callRunningBridge(
  state: DaemonState,
  method: string,
  params: unknown,
): Promise<{ result: unknown } | undefined> {
  const discovery = await readDiscoveryFile(state.pathFor(LOCAL_CONTROL_FILE));
  if (!discovery) return undefined;
  const url = `ws://127.0.0.1:${discovery.port}${LOCAL_CONTROL_PATH}?client=${CLI_LOCAL_CLIENT}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${discovery.token}` } });
    const id = 1;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('the running bridge did not answer'));
    }, CALL_TIMEOUT_MS);
    const finish = (fn: () => void): void => {
      clearTimeout(timer);
      ws.close();
      fn();
    };
    ws.on('error', () => finish(() => resolve(undefined)));
    ws.on('open', () => ws.send(JSON.stringify(makeRequest(id, method, params))));
    ws.on('message', (data) => {
      let frame: LocalControlFrame;
      try {
        frame = JSON.parse(String(data)) as LocalControlFrame;
      } catch {
        return;
      }
      if (frame.type !== 'message') return;
      const message = frame.message as {
        id?: unknown;
        result?: unknown;
        error?: { message?: string };
      };
      if (message.id !== id) return;
      if (message.error) {
        finish(() => reject(new Error(message.error?.message ?? 'the bridge refused')));
      } else {
        finish(() => resolve({ result: message.result }));
      }
    });
  });
}

/**
 * The pairing payload of the RUNNING bridge, asked over its local control
 * channel (`bridge/generatePairingQr`), which also opens that bridge's pairing
 * window — so a phone that scans it pairs with the daemon that will serve it,
 * the service included. `undefined` when no bridge runs (or it answers with
 * something that is not a valid payload).
 */
export async function runningBridgePairing(
  state: DaemonState,
  now: number = Date.now(),
): Promise<PairingPayload | undefined> {
  const live = await callRunningBridge(state, 'bridge/generatePairingQr', undefined).catch(
    () => undefined,
  );
  if (!live) return undefined;
  const checked = validatePairingPayload(live.result, now);
  return checked.valid ? checked.payload : undefined;
}
