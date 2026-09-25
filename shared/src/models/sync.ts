/**
 * Replica sync: how a client converges on the bridge's shared state without
 * trusting that it saw every notification (architecture/02a §5.8.17).
 *
 * The bridge numbers every change to shared state — a thread, a project, the
 * shared settings — with one global, persisted, strictly increasing **revision**
 * (`rev`), and keeps a bounded list of deletions. A client remembers the last
 * `rev` it applied and asks `sync/changes { since }`:
 *
 * - on every (re)connect and app resume;
 * - whenever a notification carries a `rev` that is not `last + 1` (it missed
 *   something in between).
 *
 * The answer is either the changes after `since` or, when the client cannot be
 * served incrementally (`storeId` differs — a new state directory — or `since`
 * predates the deletions the bridge still remembers), a full snapshot with
 * `reset: true` that the client applies by replacing its replica.
 */
import type { Project } from './project.js';
import type { Thread } from './thread.js';
import type { TrustedDevice } from './session.js';

/**
 * Settings the bridge shares with every client, editable from any of them
 * (`settings/set`) and from its own CLI (`uxnan-bridge config set`).
 */
export interface BridgeSettings {
  /**
   * The folder the bridge starts from, whatever directory `start` ran in: where
   * exploring for a new project begins, and the boundary a phone may register
   * projects under. Defaults to the user's home directory.
   */
  home: string;
  /**
   * What every client calls this PC. Defaults to the machine's own name; any
   * client, or `uxnan-bridge config set name`, can change it.
   */
  name: string;
}

export interface SettingsSetParams {
  /** New start folder: an absolute path to an existing directory. */
  home?: string;
  /** New name for this PC; empty goes back to the machine's own name. */
  name?: string;
  /**
   * See `ActionAgeMs`: a change made offline and sent now, applied to each
   * setting only if nobody changed that setting later.
   */
  ageMs?: number;
}

export interface SyncChangesParams {
  /** The last revision this client applied; absent on a first sync. */
  since?: number;
  /** The `storeId` that revision belongs to; a different one forces a reset. */
  storeId?: string;
}

/** What kind of client is connected. */
export type ClientKind = 'phone' | 'desktop';

/** One client connected to the bridge right now. */
export interface ClientPresence {
  /** Stable id: the phone's device id, or `local:<client>` for the desktop. */
  id: string;
  kind: ClientKind;
  /** Human name (the phone's device name, the desktop's machine name). */
  name: string;
  /** When this connection opened (epoch ms). */
  since: number;
}

export interface SyncChanges {
  /** Identity of the bridge's state directory; changes only if it is recreated. */
  storeId: string;
  /** The revision this answer brings the client up to. */
  rev: number;
  /** True → a full snapshot: replace the replica instead of merging. */
  reset: boolean;
  settings: BridgeSettings;
  /** Projects changed after `since` (all of them on a reset). */
  projects: Project[];
  /** Projects removed after `since` (empty on a reset). */
  removedProjectIds: string[];
  /** Threads changed after `since` (all of them on a reset). */
  threads: Thread[];
  /** Threads deleted after `since` (empty on a reset). */
  removedThreadIds: string[];
  /** Who is connected right now (live, not revisioned). */
  clients: ClientPresence[];
  /** Every paired phone, as it stands (small; always whole). */
  devices: TrustedDevice[];
}
