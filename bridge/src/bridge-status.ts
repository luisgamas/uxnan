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
  /** Latest published bridge version, from the background npm update check. */
  latestVersion?: string;
  /** Whether {@link latestVersion} is strictly newer than {@link version}. */
  updateAvailable?: boolean;
}

/**
 * Capabilities this build advertises to clients. Additive and hard-coded: a
 * feature is listed here by the same change that implements it, so a client can
 * ask "can this bridge do X?" instead of comparing version strings against a
 * table it would have to keep in sync.
 */
const BRIDGE_FEATURES = {
  // The per-thread message queue (architecture/02a §5.8.13).
  messageQueue: true,
  // Handing a queued follow-up to the turn already running, on agents whose CLI
  // has an input channel mid-turn (architecture/02a §5.8.13).
  midTurnDelivery: true,
} as const;

export function buildBridgeStatus(input: BridgeStatusInput): BridgeStatus {
  return {
    version: input.version,
    relayConnected: input.relayConnected,
    lanEnabled: input.lanEnabled,
    activeSessions: input.activeSessions,
    platform: platform(),
    uptimeMs: Math.max(0, input.now - input.startedAt),
    ...(input.latestVersion !== undefined ? { latestVersion: input.latestVersion } : {}),
    ...(input.updateAvailable ? { updateAvailable: true } : {}),
    features: { ...BRIDGE_FEATURES },
  };
}
