/**
 * The bridge's relay, owned in one place (architecture/02a §5.10). This
 * service is the only thing that deploys, connects, rotates or removes the
 * relay; every client — phone, desktop, CLI — asks it through `relay/*`.
 *
 * Where things live:
 * - the public endpoint (`url`, `routingId`, `enabled`) is a shared setting
 *   (`BridgeSettings.relay`, written through {@link BridgeSettingsStore}), so
 *   every paired phone converges on it through `sync/changes`;
 * - how it was set up (`provider`, Cloudflare account id, deployed version)
 *   is this service's own file, `relay.json`;
 * - a Cloudflare token is kept only if the user asked to remember it, in the
 *   system keyring — never in a file, a log, a response or a notification.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  RpcError,
  type PairingRelay,
  type RelayCredentialParams,
  type RelayEndpoint,
  type RelayProvider,
  type RelayRemoveParams,
  type RelaySetupParams,
  type RelayStatus,
} from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import type { Logger } from '../logger.js';
import type { SecretStore } from '../secret-store.js';
import type { BridgeSettingsStore } from '../settings/bridge-settings.js';
import type { MessageIO } from '../transport/message-io.js';
import type { TrustStore } from '../transport/trust-store.js';
import {
  CloudflareError,
  deployRelay,
  isAccountId,
  relayVersion,
  removeHost,
  type CloudflareTarget,
  type FetchLike,
} from './cloudflare.js';
import { RelayHost, type RelayHostState, type RelayHostTiming } from './relay-host.js';

/** `relay.json` — how the relay was set up. */
interface RelaySetupRecord {
  provider: RelayProvider;
  accountId?: string;
  deployedVersion?: string;
}

const TOKEN_KEY = 'relay.cloudflare-token';
/** How long setup waits for a fresh `workers.dev` route to start answering. */
const REACHABLE_TIMEOUT_MS = 60_000;

export interface RelayServiceOptions {
  settings: BridgeSettingsStore;
  state: DaemonState;
  secrets: SecretStore;
  trustStore: TrustStore;
  identity: { publicKeyHex: string; sign(message: string): string };
  /** Run a phone's secure session over a ready relay channel. */
  serve(io: MessageIO): Promise<void>;
  /** The relay Worker this bridge ships, and its version. */
  bundle: { read(): Promise<string>; version: string };
  logger: Logger;
  now(): number;
  onChange(status: RelayStatus): void;
  /** Override Cloudflare/relay HTTP (tests). */
  fetch?: FetchLike;
  /** Override the control-socket timing (tests). */
  hostTiming?: Partial<RelayHostTiming>;
  /** `false` keeps the control socket closed whatever the setting says (tests). */
  connect?: boolean;
  /** How long a pairing ticket stays valid (the bridge's pairing window). */
  pairingWindowMs: number;
}

export class RelayService {
  readonly #o: RelayServiceOptions;
  readonly #host: RelayHost;
  #record: RelaySetupRecord | undefined;
  #state: RelayHostState = 'off';
  #lastError: string | undefined;
  #phones = 0;
  #tokenRemembered = false;
  #applied: string | undefined;
  #ticket: { value: string; expiresAt: number } | undefined;
  #lock: Promise<unknown> = Promise.resolve();
  #unsubscribe: (() => void)[] = [];

  constructor(options: RelayServiceOptions) {
    this.#o = options;
    this.#host = new RelayHost({
      publicKeyHex: options.identity.publicKeyHex,
      sign: (message) => options.identity.sign(message),
      allowedKeys: async () => (await options.trustStore.list()).map((d) => d.publicKey),
      serve: (io) => options.serve(io),
      onState: (state, error) => {
        this.#state = state;
        this.#lastError = state === 'error' ? error : undefined;
        this.#emit();
      },
      onPhones: (count) => {
        this.#phones = count;
        this.#emit();
      },
      logger: options.logger,
      ...(options.hostTiming ? { timing: options.hostTiming } : {}),
    });
  }

  /** Load what was set up and connect if the relay is enabled. Call once. */
  async start(): Promise<void> {
    this.#record =
      (await this.#o.state.readJson<RelaySetupRecord>(DAEMON_FILES.relay)) ?? undefined;
    this.#tokenRemembered = (await this.#o.secrets.get(TOKEN_KEY).catch(() => null)) !== null;
    this.#unsubscribe.push(
      this.#o.settings.onChange(() => this.#apply()),
      this.#o.trustStore.onChange(() => void this.#host.syncAllowed().catch(() => undefined)),
    );
    this.#apply();
    void this.#refreshDeployedVersion();
  }

  stop(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#applied = undefined;
    this.#host.stop();
  }

  status(): RelayStatus {
    const endpoint = this.#o.settings.get().relay;
    return {
      endpoint,
      ...(this.#record?.provider ? { provider: this.#record.provider } : {}),
      state: endpoint?.enabled ? this.#state : 'off',
      ...(this.#lastError && endpoint?.enabled ? { lastError: this.#lastError } : {}),
      bundledVersion: this.#o.bundle.version,
      ...(this.#record?.deployedVersion ? { deployedVersion: this.#record.deployedVersion } : {}),
      tokenRemembered: this.#tokenRemembered,
      connectedPhones: this.#phones,
      hostKey: this.#o.identity.publicKeyHex,
    };
  }

  /** Deploy the relay into the user's Cloudflare account and connect to it. */
  setup(params: RelaySetupParams): Promise<RelayStatus> {
    return this.#serial(async () => {
      const accountId = params.accountId.trim().toLowerCase();
      if (!isAccountId(accountId)) {
        throw RpcError.invalidParams(
          'The Cloudflare account id should be 32 hexadecimal characters.',
        );
      }
      const apiToken = requireToken(params.apiToken);
      const { url } = await this.#cloudflare(() =>
        this.#deploy({ accountId, apiToken, ...this.#fetchOpt() }),
      );
      await this.#rememberToken(apiToken, params.remember === true);
      await this.#saveRecord({
        provider: 'cloudflare',
        accountId,
        deployedVersion: this.#o.bundle.version,
      });
      await this.#waitReachable(url);
      await this.#setEndpoint({ url, routingId: this.#routingIdFor(url), enabled: true });
      return this.status();
    });
  }

  /** Use a relay the user deployed by hand (same Worker, same protocol). */
  use(rawUrl: string): Promise<RelayStatus> {
    return this.#serial(async () => {
      const url = normalizeRelayUrl(rawUrl);
      const version = await relayVersion(url, this.#o.fetch);
      if (!version) {
        throw RpcError.invalidParams(`No Uxnan relay answers at ${url}.`);
      }
      await this.#saveRecord({ provider: 'custom', deployedVersion: version.version });
      await this.#setEndpoint({ url, routingId: this.#routingIdFor(url), enabled: true });
      return this.status();
    });
  }

  /** Turn the relay on or off, decided at [at]. */
  setEnabled(enabled: boolean, at: number): Promise<RelayStatus> {
    return this.#serial(async () => {
      const endpoint = this.#requireEndpoint();
      await this.#o.settings.set({ relay: { ...endpoint, enabled } }, at);
      return this.status();
    });
  }

  /** Deploy the relay version this bridge ships over the one in the account. */
  update(params: RelayCredentialParams): Promise<RelayStatus> {
    return this.#serial(async () => {
      this.#requireEndpoint();
      const target = await this.#cloudflareTarget(params);
      await this.#cloudflare(() => this.#deploy(target));
      await this.#rememberToken(target.apiToken, params.remember ?? this.#tokenRemembered);
      await this.#saveRecord({ ...this.#record!, deployedVersion: this.#o.bundle.version });
      this.#emit();
      return this.status();
    });
  }

  /**
   * Let another of the user's machines host on this relay: add its identity
   * key to the Worker this bridge deployed (keeping every other one), with
   * the remembered token unless one is given. The relay is then reachable for
   * it with `relay/use` and this relay's URL.
   */
  admitHost(params: RelayCredentialParams & { hostKey: string }): Promise<RelayStatus> {
    return this.#serial(async () => {
      this.#requireEndpoint();
      if (!/^[0-9a-f]{64}$/.test(params.hostKey)) {
        throw RpcError.invalidParams('hostKey must be a bridge identity key (64 hex digits).');
      }
      const target = await this.#cloudflareTarget(params);
      const bundle = await this.#o.bundle.read();
      await this.#cloudflare(() => deployRelay(target, bundle, params.hostKey));
      await this.#rememberToken(target.apiToken, params.remember ?? this.#tokenRemembered);
      // The same bundle went up with it: the Worker is now this bridge's version.
      await this.#saveRecord({ ...this.#record!, deployedVersion: this.#o.bundle.version });
      this.#emit();
      return this.status();
    });
  }

  /** A new routing id: the old one stops working; phones learn the new one by sync. */
  rotate(): Promise<RelayStatus> {
    return this.#serial(async () => {
      const endpoint = this.#requireEndpoint();
      await this.#setEndpoint({ ...endpoint, routingId: newRoutingId() });
      return this.status();
    });
  }

  /** Stop using the relay; optionally take this PC off the Worker (or delete it). */
  remove(params: RelayRemoveParams): Promise<RelayStatus> {
    return this.#serial(async () => {
      if (params.deleteWorker && this.#record?.provider === 'cloudflare') {
        const target = await this.#cloudflareTarget(params);
        const bundle = await this.#o.bundle.read();
        await this.#cloudflare(() => removeHost(target, bundle, this.#o.identity.publicKeyHex));
      }
      await this.#o.secrets.delete(TOKEN_KEY).catch(() => undefined);
      this.#tokenRemembered = false;
      this.#record = undefined;
      await this.#o.state.writeJson(DAEMON_FILES.relay, null);
      await this.#o.settings.set({ relay: null }, this.#o.now());
      return this.status();
    });
  }

  /**
   * The pairing window opened: let the relay admit one new phone presenting a
   * fresh ticket, for as long as the window lasts.
   */
  openPairing(): void {
    const endpoint = this.#o.settings.get().relay;
    if (!endpoint?.enabled) return;
    const value = randomBytes(32).toString('base64url');
    this.#ticket = { value, expiresAt: this.#o.now() + this.#o.pairingWindowMs };
    const hash = createHash('sha256').update(value, 'ascii').digest('hex');
    this.#host.openPairing(hash, this.#o.pairingWindowMs);
  }

  /** The relay as the pairing QR carries it, or `undefined` when it is off. */
  pairingRelay(): PairingRelay | undefined {
    const endpoint = this.#o.settings.get().relay;
    if (!endpoint?.enabled) return undefined;
    const ticket =
      this.#ticket && this.#ticket.expiresAt > this.#o.now() ? this.#ticket : undefined;
    return {
      url: endpoint.url,
      routingId: endpoint.routingId,
      ...(ticket ? { ticket: ticket.value } : {}),
    };
  }

  // --- internals ------------------------------------------------------------

  /** Make the live connection match the shared setting. */
  #apply(): void {
    const endpoint = this.#o.settings.get().relay;
    const wanted = endpoint?.enabled ? `${endpoint.url}|${endpoint.routingId}` : undefined;
    if (wanted === this.#applied) return this.#emit();
    this.#applied = wanted;
    if (endpoint?.enabled && this.#o.connect !== false) {
      this.#host.start({ url: endpoint.url, routingId: endpoint.routingId });
    } else this.#host.stop();
    this.#emit();
  }

  #emit(): void {
    this.#o.onChange(this.status());
  }

  async #setEndpoint(endpoint: RelayEndpoint): Promise<void> {
    await this.#o.settings.set({ relay: endpoint }, this.#o.now());
  }

  /** Keep the routing id while the relay URL stays the same. */
  #routingIdFor(url: string): string {
    const current = this.#o.settings.get().relay;
    return current && current.url === url ? current.routingId : newRoutingId();
  }

  #requireEndpoint(): RelayEndpoint {
    const endpoint = this.#o.settings.get().relay;
    if (!endpoint) throw RpcError.invalidParams('No relay is set up on this PC.');
    return endpoint;
  }

  async #deploy(target: CloudflareTarget): Promise<{ url: string }> {
    const bundle = await this.#o.bundle.read();
    return deployRelay(target, bundle, this.#o.identity.publicKeyHex);
  }

  async #cloudflareTarget(params: RelayCredentialParams): Promise<CloudflareTarget> {
    if (this.#record?.provider !== 'cloudflare' || !this.#record.accountId) {
      throw RpcError.invalidParams(
        'This relay was not set up by this bridge; update it where it was deployed.',
      );
    }
    const remembered = await this.#o.secrets.get(TOKEN_KEY).catch(() => null);
    const apiToken = params.apiToken !== undefined ? requireToken(params.apiToken) : remembered;
    if (!apiToken) {
      throw RpcError.invalidParams('A Cloudflare API token is needed for this.');
    }
    return { accountId: this.#record.accountId, apiToken, ...this.#fetchOpt() };
  }

  #fetchOpt(): { fetch?: FetchLike } {
    return this.#o.fetch ? { fetch: this.#o.fetch } : {};
  }

  async #rememberToken(token: string, remember: boolean): Promise<void> {
    if (remember) await this.#o.secrets.set(TOKEN_KEY, token);
    else await this.#o.secrets.delete(TOKEN_KEY).catch(() => undefined);
    this.#tokenRemembered = remember;
  }

  async #saveRecord(record: RelaySetupRecord): Promise<void> {
    this.#record = record;
    await this.#o.state.writeJson(DAEMON_FILES.relay, record);
  }

  /** A Cloudflare failure becomes an error the caller can show as it is. */
  async #cloudflare<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof CloudflareError) throw RpcError.invalidParams(err.message);
      throw err;
    }
  }

  /** A new `workers.dev` route takes a few seconds to answer; wait for it. */
  async #waitReachable(url: string): Promise<void> {
    const deadline = this.#o.now() + REACHABLE_TIMEOUT_MS;
    while (this.#o.now() < deadline) {
      if (await relayVersion(url, this.#o.fetch)) return;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    this.#o.logger.warn('relay deployed but not answering yet; the bridge keeps trying');
  }

  async #refreshDeployedVersion(): Promise<void> {
    const endpoint = this.#o.settings.get().relay;
    if (!endpoint || !this.#record) return;
    const version = await relayVersion(endpoint.url, this.#o.fetch);
    if (version && version.version !== this.#record.deployedVersion) {
      await this.#saveRecord({ ...this.#record, deployedVersion: version.version });
      this.#emit();
    }
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#lock.then(run);
    this.#lock = next.catch(() => undefined);
    return next;
  }
}

function newRoutingId(): string {
  return randomBytes(16).toString('hex');
}

function requireToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length < 20 || /\s/.test(trimmed)) {
    throw RpcError.invalidParams('That does not look like a Cloudflare API token.');
  }
  return trimmed;
}

/** `wss://host` (or `ws://` for a relay on this machine); paths and slashes dropped. */
export function normalizeRelayUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(
      raw
        .trim()
        .replace(/^https:/, 'wss:')
        .replace(/^http:/, 'ws:'),
    );
  } catch {
    throw RpcError.invalidParams('The relay address should look like wss://relay.example.com');
  }
  // Plain `ws://` only for a relay on this machine (development); anything
  // across a network goes over TLS.
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'wss:' && !(parsed.protocol === 'ws:' && local)) {
    throw RpcError.invalidParams('The relay address should look like wss://relay.example.com');
  }
  return `${parsed.protocol}//${parsed.host}`;
}
