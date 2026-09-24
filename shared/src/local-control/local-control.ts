/**
 * Local control channel: how a client on the **same machine** as the bridge
 * (Uxnan Desktop) talks to it without the E2EE pairing a phone needs.
 *
 * The bridge listens on loopback only, authorizes a connection with a token it
 * writes to a file only the current user can read, and serves exactly the same
 * JSON-RPC router the phones use. The client is registered as one more
 * receiver of the bridge's `stream/*` notifications, with its own `seq`, so it
 * sees every turn any client starts and is caught up after a reconnect the same
 * way a phone is.
 *
 * The trust model is the one `POST /agent-hook/approval` already uses: a local
 * route guarded by a token that only processes of the same user can read. The
 * E2EE protocol is untouched — this is not a cryptographic variant, it is a
 * loopback route.
 *
 * Source: architecture/02a-system-architecture.md §5.8.15 (local control channel).
 */

/** Wire protocol revision of the local control channel. */
export const LOCAL_CONTROL_PROTOCOL = 1;

/**
 * File (under the bridge's state directory, `~/.uxnan/`) where a running bridge
 * publishes how to reach its local control channel. Written with owner-only
 * permissions when the listener starts, removed when it stops.
 */
export const LOCAL_CONTROL_FILE = 'local-control.json';

/** HTTP path of the WebSocket upgrade. */
export const LOCAL_CONTROL_PATH = '/control';

/**
 * Largest single frame (either direction) the channel accepts. Generous because
 * a `turn/send` may inline image attachments as base64.
 */
export const LOCAL_CONTROL_MAX_FRAME_BYTES = 32 * 1024 * 1024;

/** Contents of {@link LOCAL_CONTROL_FILE}. */
export interface LocalControlDiscovery {
  protocol: number;
  /** Loopback port the listener is bound to (always `127.0.0.1`). */
  port: number;
  /**
   * Bearer token for the WebSocket upgrade (`Authorization: Bearer <token>`).
   * A fresh one is generated every time the listener starts, so a stale file
   * from a previous run cannot authorize anything.
   */
  token: string;
  /** Process id of the bridge serving it. */
  pid: number;
  /** Bridge package version. */
  bridgeVersion: string;
  /**
   * Identifies this run of the bridge. A client that reconnects to a
   * *different* instance must resync instead of expecting a replay.
   */
  instanceId: string;
}

/**
 * First frame the bridge sends on a new connection, before any replay.
 *
 * `gap` is the important bit: when true the bridge could NOT replay everything
 * the client missed (the retained window was exceeded, or the bridge restarted
 * since the client's last `seq`), so the client must resync what it has open
 * (`thread/list`, `turn/list`) instead of trusting its local state.
 */
export interface LocalControlHelloFrame {
  type: 'hello';
  protocol: number;
  bridgeVersion: string;
  instanceId: string;
  /** The client id the connection was registered under. */
  clientId: string;
  /** How many retained notifications follow this frame as a replay. */
  replayed: number;
  /** True when some notifications the client missed are unrecoverable. */
  gap: boolean;
}

/**
 * Every other frame: a JSON-RPC response to a request the client sent, or a
 * notification. Notifications carry the `seq` the client must persist and send
 * back as `resume` on its next connection; responses carry none (a request
 * pending across a disconnect is failed by the client, not replayed).
 */
export interface LocalControlMessageFrame {
  type: 'message';
  seq?: number;
  message: unknown;
}

export type LocalControlFrame = LocalControlHelloFrame | LocalControlMessageFrame;

/** Query parameters of the upgrade URL: `/control?client=<id>&resume=<seq>&instance=<id>`. */
export interface LocalControlConnectParams {
  /** Stable name of the client (e.g. `desktop`); one live connection per name. */
  client: string;
  /** Last notification `seq` the client applied (0 or absent on a fresh start). */
  resume?: number;
  /** `instanceId` of the bridge the client last talked to. */
  instance?: string;
}

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Whether `id` is an acceptable local client name (lowercase, short, no separators). */
export function isValidLocalClientId(id: string): boolean {
  return CLIENT_ID_PATTERN.test(id);
}

/**
 * The receiver id a local client is registered under in the bridge's session
 * registry. Prefixed so it can never collide with a paired phone's device id.
 */
export function localReceiverId(clientId: string): string {
  return `local:${clientId}`;
}
