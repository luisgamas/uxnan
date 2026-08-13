/**
 * Session and trust models.
 *
 * Dart equivalents: `uxnanmobile/lib/domain/entities/{secure_session,trusted_device}.dart`.
 */

export type HandshakeMode = 'qr_bootstrap' | 'trusted_reconnect';

export interface ConnectedPhone {
  deviceId: string;
  displayName: string;
  connectedAt: number;
  lastSeen: number;
}

export interface TrustedDevice {
  deviceId: string;
  displayName: string;
  /** Phone Ed25519 identity public key (hex). */
  publicKey: string;
  pairedAt: number;
  lastSeen?: number;
}

export interface BridgeStatus {
  version: string;
  relayConnected: boolean;
  lanEnabled: boolean;
  activeSessions: number;
  platform: NodeJS.Platform | string;
  uptimeMs: number;
  /**
   * Latest bridge version published to npm (dist-tag `alpha`), as discovered by
   * the bridge's own background update check. Absent when the check hasn't run
   * yet or couldn't reach the registry (offline) — never blocks status.
   */
  latestVersion?: string;
  /**
   * True when {@link latestVersion} is strictly newer than {@link version}
   * (SemVer precedence). Lets the phone show a "bridge update available" hint
   * without querying npm itself. Absent/false when unknown or up to date.
   */
  updateAvailable?: boolean;
  /**
   * Optional capabilities this bridge supports, so a newer client offers a
   * feature only where it actually works instead of inferring it from the
   * version string. **Absent means "assume none"** — an older bridge simply
   * omits the field and the client falls back to the pre-feature behaviour.
   *
   * This matters because guessing wrong is not a cosmetic degradation: a client
   * that offers to queue a follow-up against a bridge that cannot queue makes it
   * start a second CONCURRENT turn, which corrupts the agent session (two CLI
   * processes on one `--resume`; OpenCode retires the running turn outright).
   */
  features?: BridgeFeatures;
}

/** Optional, additive bridge capabilities advertised on {@link BridgeStatus}. */
export interface BridgeFeatures {
  /**
   * The bridge queues a `turn/send` that arrives while a turn is in flight
   * (stored as a `queued` turn, drained on completion) instead of starting it
   * concurrently, and implements `queue/resume` / `queue/clear`. Absent/false →
   * the client must NOT offer to queue: sending during a live turn is unsafe on
   * that bridge.
   */
  messageQueue?: boolean;
  /**
   * The bridge can hand a queued turn to the agent **inside the turn already
   * running**, for agents whose CLI has an input channel mid-turn — it marks
   * that turn `delivered` and emits `stream/turn/delivered`. Absent/false → the
   * client must expect every follow-up to wait for the current turn to end, and
   * must not promise otherwise in its UI.
   *
   * Distinct from {@link messageQueue}, which this builds on: the queue is where
   * a follow-up lands, and per-agent `AgentCapabilities.steering` decides
   * whether it waits there or goes straight through.
   */
  midTurnDelivery?: boolean;
  /**
   * The bridge resolves where a worktree goes on its own, so `git/createWorktree`
   * accepts `managed: true` **without** a `path` and places it under the managed
   * root (`<home>/uxnan/worktrees/<repo>/<branch>` by default) — the same layout
   * the desktop uses, so one repository's checkouts stay grouped no matter which
   * app created them.
   *
   * Absent/false → the bridge still **requires** `path`, and a client must keep
   * deriving one itself. That fallback is worth keeping aligned with the
   * desktop's spelling: the two derivations had already drifted into different
   * folder names for the same repository and branch.
   */
  managedWorktrees?: boolean;
}
