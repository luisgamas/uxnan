/**
 * Runs the relay Worker locally on the real Workers runtime (workerd, through
 * Miniflare) — the same bundle the bridge uploads to Cloudflare. Used by the
 * relay's own tests and by the bridge's end-to-end tests, so both prove
 * behaviour against the real runtime instead of a stand-in server.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { RELAY_COMPATIBILITY_DATE } from '@uxnan/shared/relay';

export interface LocalRelayOptions {
  /** Ed25519 public keys (hex) of the bridges allowed to host. */
  hostKeys: string[];
  /** TCP port; 0 (default) picks a free one. */
  port?: number;
}

export interface LocalRelayHandle {
  /** `ws://127.0.0.1:<port>` — what a bridge or phone dials. */
  url: string;
  close(): Promise<void>;
}

/** Absolute path of the built Worker bundle (`npm run build` in `relay/`). */
export function relayWorkerBundlePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker', 'uxnan-relay.js');
}

export async function startLocalRelay(options: LocalRelayOptions): Promise<LocalRelayHandle> {
  const mf = new Miniflare({
    host: '127.0.0.1',
    port: options.port ?? 0,
    // By content, not path: the runtime refuses a path that climbs out of the
    // process's working directory, and callers start from anywhere.
    modules: [
      {
        type: 'ESModule',
        path: 'uxnan-relay.js',
        contents: readFileSync(relayWorkerBundlePath(), 'utf8'),
      },
    ],
    compatibilityDate: RELAY_COMPATIBILITY_DATE,
    durableObjects: { RELAY: { className: 'RelayRoom', useSQLite: true } },
    bindings: { UXNAN_HOST_KEYS: options.hostKeys.join(',') },
  });
  const ready = await mf.ready;
  return {
    url: `ws://${ready.host}`,
    close: () => mf.dispose(),
  };
}
