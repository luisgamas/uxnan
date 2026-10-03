/**
 * The user's own relay, as the bridge reports and manages it (`relay/*`,
 * architecture/02a §5.10). The bridge owns this capability: it deploys the
 * relay into the user's Cloudflare account, keeps its control socket open and
 * tells every client how it stands; phones, the desktop and the CLI only ask.
 */

/**
 * Where a phone reaches this bridge from another network. Public data only —
 * it travels in the shared settings (`BridgeSettings.relay`) so every paired
 * phone learns it while on the LAN and can leave home without pairing again.
 */
export interface RelayEndpoint {
  /** `wss://…` base URL of the relay (no path). */
  url: string;
  /** This bridge's room on that relay: 32 lowercase hex chars. */
  routingId: string;
  /** Whether the bridge is serving phones through it right now. */
  enabled: boolean;
}

/** How the relay got there: deployed by this bridge, or pasted by the user. */
export type RelayProvider = 'cloudflare' | 'custom';

export type RelayConnectionState = 'off' | 'connecting' | 'connected' | 'error';

export interface RelayStatus {
  /** `null` until a relay is set up. */
  endpoint: RelayEndpoint | null;
  provider?: RelayProvider;
  state: RelayConnectionState;
  /** Why the last attempt failed, in words a person can act on. */
  lastError?: string;
  /** Version of the relay this bridge ships — what `relay/update` deploys. */
  bundledVersion: string;
  /** Version the relay reports (`GET /v1/version`), when known. */
  deployedVersion?: string;
  /** A Cloudflare token is remembered (system keyring) for updating or removing. */
  tokenRemembered: boolean;
  /** Phones talking to this bridge through the relay right now. */
  connectedPhones: number;
  /**
   * This bridge's Ed25519 identity public key (hex) — public. A relay deployed
   * by hand must list it in its `UXNAN_HOST_KEYS` for this bridge to host.
   */
  hostKey: string;
}

/**
 * Deploy the relay into the user's Cloudflare account. The token is used for
 * this call and dropped, unless `remember` keeps it in the system keyring. It
 * never appears in any response, notification or log.
 */
export interface RelaySetupParams {
  provider: 'cloudflare';
  accountId: string;
  apiToken: string;
  remember?: boolean;
}

/** Use a relay the user deployed themselves (same Worker, same protocol). */
export interface RelayUseParams {
  url: string;
}

export interface RelaySetParams {
  enabled: boolean;
  /** A change made offline and sent now: applied only if nobody decided later. */
  ageMs?: number;
}

/**
 * For actions that need Cloudflare again (`relay/update`, `relay/remove` with
 * `deleteWorker`): the token, unless one is remembered.
 */
export interface RelayCredentialParams {
  apiToken?: string;
  remember?: boolean;
}

export interface RelayRemoveParams extends RelayCredentialParams {
  /** Also delete the Worker from the Cloudflare account. */
  deleteWorker?: boolean;
}

/** `stream/relay/updated`: the whole status, as `relay/status` would answer now. */
export interface RelayUpdatedNotification {
  status: RelayStatus;
}
