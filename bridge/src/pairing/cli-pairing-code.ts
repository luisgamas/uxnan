/**
 * What `uxnan-bridge code` prints (architecture/02a §5.5.3, §5.8.5).
 *
 * A running bridge — the service, or one started by hand — is ASKED for its
 * code over its local control channel (`bridge/pairingCode`), which also opens
 * ITS pairing window, so the phone that types the code enrolls with the daemon
 * that serves it. No second bridge is stood up for this.
 *
 * With no bridge answering, the code comes from the store every bridge shares
 * (`~/.uxnan/pairing-code.json`, `PairingCodeService`): the bridge that starts
 * next — or one running without the channel, or one older than the method —
 * accepts the same code for the rest of its lifetime, and a phone resolving it
 * opens that bridge's window. Only the code store is touched: no LAN server,
 * relay, keyring or identity.
 */
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import { runningBridgePairingCode } from '../local-control-client.js';
import { PairingCodeService } from './pairing-code-service.js';

export interface CliPairingCode {
  /** The code, grouped for reading (`ABCD-EFGH`). */
  code: string;
  /** `running`: the live bridge's own; `stored`: from the shared code store. */
  source: 'running' | 'stored';
}

export async function pairingCodeForCli(
  state: DaemonState,
  now: () => number = () => Date.now(),
): Promise<CliPairingCode> {
  const live = await runningBridgePairingCode(state);
  if (live) return { code: live.code, source: 'running' };
  const store = new PairingCodeService({
    // Only a bridge serving `/pair/resolve` builds a payload; issuing a code
    // never does.
    buildPayload: () => {
      throw new Error('no pairing payload outside a running bridge');
    },
    now,
    statePath: state.pathFor(DAEMON_FILES.pairingCode),
  });
  return { code: store.currentCode(), source: 'stored' };
}
