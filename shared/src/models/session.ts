/**
 * Session and trust models.
 *
 * Dart equivalents: `uxnanmobile/lib/domain/entities/{secure_session,trusted_device}.dart`.
 */
import type { ClientPresence } from './sync.js';

export type HandshakeMode = 'qr_bootstrap' | 'trusted_reconnect';

export interface ConnectedPhone {
  deviceId: string;
  displayName: string;
  connectedAt: number;
  lastSeen: number;
}

export interface TrustedDevice {
  deviceId: string;
  /**
   * The phone's name on every client: what the phone calls itself
   * (`device/describe`) until someone names it (`device/rename`, on the phone
   * or on the desktop) — then that name, the same everywhere.
   */
  displayName: string;
  /** Phone Ed25519 identity public key (hex). */
  publicKey: string;
  pairedAt: number;
  lastSeen?: number;
  /** Who chose `displayName`: the phone itself, or a person. */
  nameSource?: 'device' | 'user';
  /** Maker and model, as the phone reports them (e.g. `samsung SM-A556E`). */
  model?: string;
  /** `android` or `ios`. */
  platform?: string;
  /** The operating system's version. */
  osVersion?: string;
  /** The Uxnan app version the phone runs. */
  appVersion?: string;
}

/**
 * `device/describe`: a phone, right after connecting, says what it is and what
 * it is called (architecture/02a §5.8.17). Only a phone may call it, and only
 * about itself.
 */
export interface DeviceDescribeParams {
  /** Its name: the one the user gave it, or its own default (the model). */
  name: string;
  /**
   * How long ago the user chose [name] (`ActionAgeMs`); absent while the name
   * is the phone's default. The bridge keeps the latest decision — this one,
   * or a rename made on another client since.
   */
  nameAgeMs?: number;
  model?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
}

/** The phone's record as it stands, and how long ago its name was decided. */
export interface DeviceDescription {
  device: TrustedDevice;
  /** Absent while the name is the phone's default (never decided by a person). */
  nameAgeMs?: number;
}

/** `device/rename`: name a paired phone, from any client. */
export interface DeviceRenameParams {
  deviceId: string;
  /** The new name; empty goes back to the phone's own name. */
  name: string;
  /** See `ActionAgeMs`: a rename made offline and sent now. */
  ageMs?: number;
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
   * Threads with a turn in flight right now, whichever client started it.
   * Absent on an older bridge. A client uses it to wait for a quiet moment
   * before anything that restarts the bridge (Uxnan Desktop's bridge update),
   * so no one's running turn is cut.
   */
  activeTurns?: number;
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
  /** How this bridge was started and on which machine. Absent on an older bridge. */
  host?: BridgeHost;
  /** Who is connected right now. Absent on an older bridge. */
  clients?: ClientPresence[];
}

/**
 * What started the bridge: its own user service (`service` — the normal case,
 * it outlives Uxnan Desktop), Uxnan Desktop directly (`desktop`), or a person
 * in a terminal (`cli`).
 */
export type BridgeLaunchedBy = 'service' | 'desktop' | 'cli';

export interface BridgeHost {
  launchedBy: BridgeLaunchedBy;
  /** The machine's name, as a phone shows it ("Linked with Uxnan Desktop on …"). */
  machineName: string;
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
  /**
   * The bridge is serving the loopback **local control channel**
   * (`LOCAL_CONTROL_FILE`, architecture/02a §5.8.15) right now, so a client on
   * the same machine can drive it without pairing. Unlike the other flags this
   * one is live, not build-level: it is absent while the listener is off
   * (`localControlEnabled: false`, or a short-lived CLI command).
   */
  localControl?: boolean;
  /**
   * The bridge serves replica sync (`sync/changes`), the persistent project
   * registry (`project/add|remove|rename`, `stream/project/*`), shared settings
   * (`settings/*`), presence (`stream/presence/updated`) and orders turns by
   * `Turn.seq`. Absent/false → a client keeps its older `thread/list` flow.
   */
  sync?: boolean;
}
