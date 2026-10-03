/**
 * The bridge's side of its relay (architecture/02a §5.10): one control socket
 * that stays open — the relay hibernates it, so it costs nothing while idle —
 * and one channel socket per phone, opened when the relay says a trusted phone
 * is waiting (`dial`). Each channel, once ready, is handed to the same secure
 * session the LAN path runs; the relay only ever sees its E2EE frames.
 *
 * Protocol: `@uxnan/shared/relay`. This module keeps the relay told which
 * phones it may admit (`allow`) and, while pairing is open, which one-time
 * ticket admits a new phone (`ticket`).
 */
import { WebSocket, type RawData } from 'ws';
import {
  RELAY_CLOSE,
  RELAY_PING,
  RELAY_PONG,
  parseRelayServerFrame,
  relayRoutePath,
  relaySigningMessage,
  type RelayClientFrame,
  type RelayRoute,
} from '@uxnan/shared/relay';
import type { Logger } from '../logger.js';
import type { MessageIO } from '../transport/message-io.js';
import { rawDataToBuffer, wsToMessageIO } from '../transport/ws-adapter.js';

export type RelayHostState = 'off' | 'connecting' | 'connected' | 'error';

export interface RelayHostTarget {
  /** `wss://…` base URL of the relay (no path). */
  url: string;
  routingId: string;
}

export interface RelayHostOptions {
  /** This bridge's Ed25519 identity public key (hex) — its host key. */
  publicKeyHex: string;
  /** Sign a message with the bridge identity; returns the signature (hex). */
  sign(message: string): string;
  /** The trusted phones' identity keys, as they stand now. */
  allowedKeys(): Promise<string[]>;
  /** Run a secure session over a ready channel; resolves when it ends. */
  serve(io: MessageIO): Promise<void>;
  /** The connection state changed (`error` carries a reason a person can act on). */
  onState(state: RelayHostState, error?: string): void;
  /** The number of phones talking through the relay changed. */
  onPhones?(count: number): void;
  logger: Logger;
  /** Override the timing (tests). */
  timing?: Partial<RelayHostTiming>;
}

export interface RelayHostTiming {
  /** Keepalive interval on the control socket (answered without waking the relay). */
  pingMs: number;
  /** First reconnect delay; doubles up to {@link maxBackoffMs}. */
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** A control connection that lasted this long resets the backoff. */
  healthyMs: number;
  /** Give up on a handshake (challenge/ready) after this long. */
  handshakeMs: number;
}

const DEFAULT_TIMING: RelayHostTiming = {
  pingMs: 30_000,
  baseBackoffMs: 2_000,
  maxBackoffMs: 60_000,
  healthyMs: 30_000,
  handshakeMs: 15_000,
};

/** Close codes after which retrying soon cannot help: the relay refuses this bridge. */
const REFUSED = new Set<number>([RELAY_CLOSE.notAllowed, RELAY_CLOSE.authFailed]);

export class RelayHost {
  readonly #options: RelayHostOptions;
  readonly #timing: RelayHostTiming;
  #target: RelayHostTarget | undefined;
  #control: WebSocket | undefined;
  #pingTimer: NodeJS.Timeout | undefined;
  #retryTimer: NodeJS.Timeout | undefined;
  #backoffMs: number;
  #generation = 0;
  #pendingTicket: { hash: string; expiresAt: number } | undefined;
  readonly #channels = new Set<WebSocket>();

  constructor(options: RelayHostOptions) {
    this.#options = options;
    this.#timing = { ...DEFAULT_TIMING, ...(options.timing ?? {}) };
    this.#backoffMs = this.#timing.baseBackoffMs;
  }

  /** Phones currently talking through the relay. */
  get phones(): number {
    return this.#channels.size;
  }

  /** Connect to [target] (replacing any previous one) and stay connected. */
  start(target: RelayHostTarget): void {
    this.stop();
    this.#target = target;
    this.#backoffMs = this.#timing.baseBackoffMs;
    this.#connect(this.#generation);
  }

  /** Disconnect everything, including live phone channels. */
  stop(): void {
    this.#generation += 1;
    this.#target = undefined;
    clearInterval(this.#pingTimer);
    clearTimeout(this.#retryTimer);
    this.#pingTimer = undefined;
    this.#retryTimer = undefined;
    closeQuietly(this.#control);
    this.#control = undefined;
    for (const channel of this.#channels) closeQuietly(channel);
    this.#channels.clear();
    this.#options.onPhones?.(0);
    this.#options.onState('off');
  }

  /** Tell the relay the trusted phones changed (no-op while disconnected). */
  async syncAllowed(): Promise<void> {
    const keys = await this.#options.allowedKeys();
    this.#send({ t: 'allow', keys });
  }

  /**
   * Open a pairing window on the relay: it admits ONE new phone presenting the
   * ticket whose SHA-256 is [hash], for [ttlMs]. Re-sent after a reconnect
   * while the window is still open.
   */
  openPairing(hash: string, ttlMs: number): void {
    this.#pendingTicket = { hash, expiresAt: Date.now() + ttlMs };
    this.#send({ t: 'ticket', hash, ttlMs });
  }

  #send(frame: RelayClientFrame): void {
    const control = this.#control;
    if (control?.readyState === WebSocket.OPEN && this.#isReady(control)) {
      control.send(JSON.stringify(frame));
    }
  }

  #ready = new WeakSet<WebSocket>();

  #isReady(ws: WebSocket): boolean {
    return this.#ready.has(ws);
  }

  #connect(generation: number): void {
    const target = this.#target;
    if (!target || generation !== this.#generation) return;
    this.#options.onState('connecting');
    const ws = new WebSocket(`${target.url}${relayRoutePath('host', target.routingId)}`);
    this.#control = ws;
    const openedAt = Date.now();
    let lastError: string | undefined;

    const handshake = this.#authenticate(ws, target, 'host');
    handshake.then(
      async () => {
        if (generation !== this.#generation) return closeQuietly(ws);
        this.#ready.add(ws);
        this.#options.onState('connected');
        this.#options.logger.info('relay connected');
        await this.syncAllowed().catch(() => undefined);
        const ticket = this.#pendingTicket;
        const ttlMs = ticket ? ticket.expiresAt - Date.now() : 0;
        if (ticket && ttlMs > 0) this.#send({ t: 'ticket', hash: ticket.hash, ttlMs });
        this.#pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(RELAY_PING);
        }, this.#timing.pingMs);
        this.#pingTimer.unref?.();
        ws.on('message', (data: RawData, isBinary: boolean) => {
          if (isBinary) return;
          const text = rawDataToBuffer(data).toString('utf8');
          if (text === RELAY_PONG) return;
          const frame = parseRelayServerFrame(text);
          if (frame?.t === 'dial') this.#openChannel(target, frame.channel, generation);
        });
      },
      (err: unknown) => {
        lastError = describe(err);
        closeQuietly(ws);
      },
    );

    ws.on('error', (err) => {
      lastError = describe(err);
    });
    ws.on('close', (code) => {
      clearInterval(this.#pingTimer);
      this.#pingTimer = undefined;
      if (generation !== this.#generation) return;
      this.#control = undefined;
      const lived = Date.now() - openedAt;
      if (lived >= this.#timing.healthyMs) this.#backoffMs = this.#timing.baseBackoffMs;
      const refused = REFUSED.has(code);
      const reason = refused
        ? 'the relay refused this bridge (it was set up for another PC, or the key changed) — set it up again'
        : (lastError ?? closeReason(code));
      this.#options.onState('error', reason);
      if (code === RELAY_CLOSE.replaced) {
        this.#options.logger.warn('relay: another connection of this bridge replaced this one');
      }
      // A refusal will not fix itself: retry at the slowest pace only.
      const delay = refused ? this.#timing.maxBackoffMs : this.#backoffMs;
      this.#backoffMs = Math.min(this.#backoffMs * 2, this.#timing.maxBackoffMs);
      this.#retryTimer = setTimeout(() => this.#connect(generation), delay);
      this.#retryTimer.unref?.();
    });
  }

  #openChannel(target: RelayHostTarget, channelId: string, generation: number): void {
    const ws = new WebSocket(
      `${target.url}${relayRoutePath('channel', target.routingId, channelId)}`,
    );
    this.#channels.add(ws);
    this.#options.onPhones?.(this.#channels.size);
    const forget = (): void => {
      if (this.#channels.delete(ws)) this.#options.onPhones?.(this.#channels.size);
    };
    ws.on('close', forget);
    ws.on('error', () => undefined);
    this.#authenticate(ws, target, 'channel', channelId).then(
      async () => {
        if (generation !== this.#generation) return closeQuietly(ws);
        try {
          await this.#options.serve(wsToMessageIO(ws));
        } catch (err) {
          this.#options.logger.warn(`relay channel ended: ${describe(err)}`);
        } finally {
          closeQuietly(ws);
          forget();
        }
      },
      (err: unknown) => {
        this.#options.logger.warn(`relay channel failed: ${describe(err)}`);
        closeQuietly(ws);
        forget();
      },
    );
  }

  /**
   * Answer the relay's challenge on [ws] and resolve once it says `ready`.
   * Every frame after that belongs to whoever takes the socket next.
   */
  #authenticate(
    ws: WebSocket,
    target: RelayHostTarget,
    route: Exclude<RelayRoute, 'phone'>,
    channelId?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('the relay did not answer in time'));
      }, this.#timing.handshakeMs);
      const onMessage = (data: RawData, isBinary: boolean): void => {
        if (isBinary) return fail(new Error('unexpected binary frame before ready'));
        const frame = parseRelayServerFrame(rawDataToBuffer(data).toString('utf8'));
        if (frame?.t === 'challenge') {
          const message = relaySigningMessage({
            route,
            host: new URL(target.url).host,
            routingId: target.routingId,
            ...(channelId !== undefined ? { channelId } : {}),
            nonce: frame.nonce,
          });
          const sig = this.#options.sign(message);
          ws.send(
            JSON.stringify(
              route === 'host'
                ? { t: 'host-auth', key: this.#options.publicKeyHex, sig }
                : { t: 'channel-auth', sig },
            ),
          );
          return;
        }
        if (frame?.t === 'ready') {
          cleanup();
          resolve();
          return;
        }
        fail(new Error('unexpected frame from the relay'));
      };
      const onClose = (code: number): void => {
        cleanup();
        reject(new Error(closeReason(code)));
      };
      const fail = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        ws.off('message', onMessage);
        ws.off('close', onClose);
      };
      ws.on('message', onMessage);
      ws.on('close', onClose);
    });
  }
}

function closeQuietly(ws: WebSocket | undefined): void {
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    else ws.close();
  } catch {
    // already closed
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A close code, in words a person can act on. */
export function closeReason(code: number): string {
  switch (code) {
    case RELAY_CLOSE.authFailed:
      return 'the relay rejected this bridge’s signature';
    case RELAY_CLOSE.authTimeout:
      return 'the relay timed out waiting for this bridge';
    case RELAY_CLOSE.notAllowed:
      return 'the relay does not accept this bridge';
    case RELAY_CLOSE.replaced:
      return 'another connection of this bridge took over';
    case RELAY_CLOSE.badFrame:
      return 'the relay and this bridge do not speak the same protocol — update the relay';
    case 1006:
      return 'the connection to the relay dropped';
    default:
      return `the relay closed the connection (${code})`;
  }
}
