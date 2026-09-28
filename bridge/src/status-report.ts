/**
 * What `uxnan-bridge status` prints (architecture/02a §5.8.5).
 *
 * A short-lived command never stands up a second bridge to describe the first:
 * a running bridge — the service, or one started by hand — is ASKED for its
 * own `bridge/status` over its local control channel (§5.8.15), so the answer
 * is that daemon's uptime, clients, host and update. With none running, the
 * report says so and nothing is started: no LAN server, relay, keyring, logger
 * or state directory is touched.
 */
import { platform } from 'node:os';
import type { BridgeStatus } from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from './daemon-state.js';
import { callRunningBridge } from './local-control-client.js';
import { LockFile, isProcessAlive } from './lock-file.js';

/**
 * The printed report. `running` is added so a script can tell the three cases
 * apart; with a reachable bridge every other field is its `bridge/status`
 * result, unchanged.
 */
export type BridgeStatusReport =
  | ({ running: true } & BridgeStatus)
  | {
      /** A bridge holds the lock but its local control channel is not reachable. */
      running: true;
      pid: number;
      /** The version installed here (the running one may differ). */
      version: string;
      platform: string;
      detail: string;
    }
  | {
      running: false;
      /** The version installed here. */
      version: string;
      platform: string;
    };

export interface StatusReportDeps {
  /** The installed bridge's version (the CLI's own). */
  installedVersion: string;
  /** Whether a pid is alive; injectable for tests. */
  isAlive?: (pid: number) => boolean;
}

/**
 * Asks the running bridge for its status, or reports that none runs. Rejects
 * only when a bridge took the call and failed it (an error, no answer, or an
 * answer that is not a status).
 */
export async function bridgeStatusReport(
  state: DaemonState,
  deps: StatusReportDeps,
): Promise<BridgeStatusReport> {
  const live = await callRunningBridge(state, 'bridge/status', undefined);
  if (live) {
    if (!isBridgeStatus(live.result)) {
      throw new Error('the running bridge answered with something that is not a status');
    }
    return { running: true, ...live.result };
  }

  const isAlive = deps.isAlive ?? isProcessAlive;
  const held = await new LockFile(state.pathFor(DAEMON_FILES.lock)).read();
  if (held && isAlive(held.pid)) {
    return {
      running: true,
      pid: held.pid,
      version: deps.installedVersion,
      platform: platform(),
      detail:
        'The running bridge has no local control channel to answer on, so its live status cannot be read.',
    };
  }
  return { running: false, version: deps.installedVersion, platform: platform() };
}

/** The minimum a `bridge/status` result must carry to be printed as one. */
function isBridgeStatus(value: unknown): value is BridgeStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['version'] === 'string' && typeof v['uptimeMs'] === 'number';
}
