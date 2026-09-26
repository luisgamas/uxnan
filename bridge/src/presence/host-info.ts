/**
 * What started this bridge and on which machine (`BridgeStatus.host`).
 *
 * The service installer and Uxnan Desktop set `UXNAN_BRIDGE_HOST` on the
 * process they launch (`service` / `desktop`); anything else is a person in a
 * terminal (`cli`). The machine name is the one the user gave the computer —
 * "Luis's MacBook Pro", not `luiss-mbp.local` — because the phone shows it.
 */
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import type { BridgeHost, BridgeLaunchedBy } from '@uxnan/shared';

/** Environment variable a launcher sets to say what it is. */
export const BRIDGE_HOST_ENV = 'UXNAN_BRIDGE_HOST';

export function launchedBy(env: NodeJS.ProcessEnv = process.env): BridgeLaunchedBy {
  const value = env[BRIDGE_HOST_ENV];
  return value === 'service' || value === 'desktop' ? value : 'cli';
}

/** The computer's user-facing name, falling back to its host name. */
export function machineName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    try {
      const name = execFileSync('scutil', ['--get', 'ComputerName'], {
        encoding: 'utf-8',
        timeout: 2_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (name.length > 0) return name;
    } catch {
      /* fall through */
    }
  }
  const host = hostname();
  return host.replace(/\.local$/i, '') || host;
}

export function bridgeHost(): BridgeHost {
  return { launchedBy: launchedBy(), machineName: machineName() };
}
