/**
 * Heartbeat / status snapshot of the bridge.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (bridge-status).
 */
import { platform } from 'node:os';
import type { BridgeStatus } from '@uxnan/shared';

export interface BridgeStatusInput {
  version: string;
  relayConnected: boolean;
  lanEnabled: boolean;
  activeSessions: number;
  /** Process start time in epoch ms. */
  startedAt: number;
  /** Current time in epoch ms (injected for testability). */
  now: number;
}

export function buildBridgeStatus(input: BridgeStatusInput): BridgeStatus {
  return {
    version: input.version,
    relayConnected: input.relayConnected,
    lanEnabled: input.lanEnabled,
    activeSessions: input.activeSessions,
    platform: platform(),
    uptimeMs: Math.max(0, input.now - input.startedAt),
  };
}
