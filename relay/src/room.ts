/**
 * One relay room per bridge `routingId`: a Durable Object that authenticates
 * the bridge and its trusted phones, pairs each phone with a channel the bridge
 * opens for it, and then forwards their frames without reading them.
 *
 * It uses the WebSocket Hibernation API, so a bridge's idle control socket
 * costs nothing: the object is evicted from memory between messages, its
 * sockets stay open, and keepalive pings are answered by the runtime without
 * waking it. Everything that must survive an eviction therefore lives either in
 * a socket's attachment or in the object's SQLite storage — never in a field.
 *
 * What it stores: the bound host key, the trusted phone keys the bridge sent,
 * and the SHA-256 of any open pairing ticket. Nothing from the traffic.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  RELAY_AUTH_TIMEOUT_MS,
  RELAY_CLOSE,
  RELAY_DIAL_TIMEOUT_MS,
  RELAY_MAX_CONTROL_FRAME_BYTES,
  RELAY_MAX_PHONE_CONNECTIONS,
  RELAY_MAX_SOCKETS,
  RELAY_PING,
  RELAY_PONG,
  RELAY_PROTOCOL_VERSION,
  parseRelayClientFrame,
  parseRelayPath,
  relaySigningMessage,
  type RelayCloseCode,
  type RelayRoute,
} from '@uxnan/shared/relay';

export interface RelayEnv {
  RELAY: DurableObjectNamespace<RelayRoom>;
  /** Comma-separated Ed25519 public keys (hex) of the bridges allowed to host. */
  UXNAN_HOST_KEYS?: string;
}

/** Per-socket state, kept in the socket's attachment so it survives hibernation. */
interface SocketState {
  route: RelayRoute;
  routingId: string;
  /** Host of the URL the client dialled — part of what it signs. */
  host: string;
  /** Phone/channel: the channel id pairing them (`p:<id>` / `c:<id>` tags). */
  channel?: string;
  nonce: string;
  authed: boolean;
  /** Epoch ms after which an unauthenticated (or still-dialling) socket is closed. */
  deadline?: number;
  /** Phone: the identity key it proved. */
  key?: string;
  /** Phone: admitted by a pairing ticket (not yet on the allow list). */
  viaTicket?: boolean;
  /** Phone/channel: both ends are ready and frames flow. */
  paired?: boolean;
}

export class RelayRoom extends DurableObject<RelayEnv> {
  readonly #sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: RelayEnv) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS allowed (key TEXT PRIMARY KEY)`);
    this.#sql.exec(
      `CREATE TABLE IF NOT EXISTS tickets (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
    );
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(RELAY_PING, RELAY_PONG));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parsed = parseRelayPath(url.pathname);
    if (!parsed) return new Response('Not Found', { status: 404 });

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= RELAY_MAX_SOCKETS) {
      return new Response('Relay full', { status: 503 });
    }
    if (
      parsed.route === 'phone' &&
      this.ctx.getWebSockets('phone').length >= RELAY_MAX_PHONE_CONNECTIONS
    ) {
      return new Response('Relay full', { status: 503 });
    }

    const channel = parsed.route === 'phone' ? randomHex(16) : parsed.channelId;
    const tags: string[] = [parsed.route];
    if (parsed.route === 'phone') tags.push(`p:${channel}`);
    if (parsed.route === 'channel') tags.push(`c:${channel}`);

    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server, tags);
    const state: SocketState = {
      route: parsed.route,
      routingId: parsed.routingId,
      host: url.host,
      ...(channel !== undefined ? { channel } : {}),
      nonce: randomHex(32),
      authed: false,
      deadline: Date.now() + RELAY_AUTH_TIMEOUT_MS,
    };
    server.serializeAttachment(state);
    server.send(JSON.stringify({ t: 'challenge', v: RELAY_PROTOCOL_VERSION, nonce: state.nonce }));
    await this.#scheduleAlarm();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const state = attachment(ws);
    if (!state) return close(ws, RELAY_CLOSE.badFrame, 'no state');

    // Paired phone ⇄ channel: forward verbatim. This is the hot path.
    if (state.paired) {
      const peerTag = state.route === 'phone' ? `c:${state.channel}` : `p:${state.channel}`;
      for (const peer of this.ctx.getWebSockets(peerTag)) peer.send(message);
      return;
    }

    if (typeof message !== 'string' || message.length > RELAY_MAX_CONTROL_FRAME_BYTES) {
      return close(ws, RELAY_CLOSE.badFrame, 'control frames are small JSON text');
    }
    const frame = parseRelayClientFrame(message);
    if (!frame) return close(ws, RELAY_CLOSE.badFrame, 'malformed frame');

    if (!state.authed) {
      if (state.route === 'host' && frame.t === 'host-auth') {
        return this.#authHost(ws, state, frame.key, frame.sig);
      }
      if (state.route === 'channel' && frame.t === 'channel-auth') {
        return this.#authChannel(ws, state, frame.sig);
      }
      if (state.route === 'phone' && frame.t === 'phone-auth') {
        return this.#authPhone(ws, state, frame.key, frame.sig, frame.ticket);
      }
      return close(ws, RELAY_CLOSE.authFailed, 'expected the auth frame for this route');
    }

    if (state.route !== 'host') return; // a dialling phone has nothing to say yet
    if (frame.t === 'allow') return this.#setAllowed(frame.keys);
    if (frame.t === 'ticket') {
      this.#sql.exec(`DELETE FROM tickets WHERE expires_at <= ?`, Date.now());
      this.#sql.exec(
        `INSERT OR REPLACE INTO tickets (hash, expires_at) VALUES (?, ?)`,
        frame.hash,
        Date.now() + frame.ttlMs,
      );
      return;
    }
    return close(ws, RELAY_CLOSE.badFrame, 'unexpected frame on the host route');
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.#dropPeer(ws, code, reason);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.#dropPeer(ws, RELAY_CLOSE.peerClosed, 'socket error');
  }

  /** Closes unauthenticated sockets past their deadline and phones nobody dialled. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const state = attachment(ws);
      if (ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      if (!state || state.deadline === undefined || state.deadline > now) continue;
      if (!state.authed) close(ws, RELAY_CLOSE.authTimeout, 'no auth in time');
      else if (state.route === 'phone' && !state.paired) {
        close(ws, RELAY_CLOSE.bridgeTimeout, 'the bridge did not answer');
      }
    }
    this.#sql.exec(`DELETE FROM tickets WHERE expires_at <= ?`, now);
    await this.#scheduleAlarm();
  }

  // --- auth ---------------------------------------------------------------

  async #authHost(ws: WebSocket, state: SocketState, key: string, sig: string): Promise<void> {
    const hostKeys = parseHostKeys(this.env.UXNAN_HOST_KEYS);
    const bound = this.#meta('host_key');
    if (!hostKeys.includes(key) || (bound !== undefined && bound !== key)) {
      return close(ws, RELAY_CLOSE.notAllowed, 'not a host of this relay');
    }
    if (!(await verify(key, sig, signingMessage(state)))) {
      return close(ws, RELAY_CLOSE.authFailed, 'bad signature');
    }
    if (bound === undefined) this.#setMeta('host_key', key);
    // One live control socket per bridge: the newest wins (a restart, a network
    // change), so a half-open old socket cannot swallow the dials.
    for (const other of this.ctx.getWebSockets('host')) {
      if (other !== ws && attachment(other)?.authed) close(other, RELAY_CLOSE.replaced, 'replaced');
    }
    this.#markReady(ws, { ...state, authed: true });
  }

  async #authChannel(ws: WebSocket, state: SocketState, sig: string): Promise<void> {
    const bound = this.#meta('host_key');
    if (bound === undefined || !(await verify(bound, sig, signingMessage(state)))) {
      return close(ws, RELAY_CLOSE.authFailed, 'bad signature');
    }
    const phone = this.ctx
      .getWebSockets(`p:${state.channel}`)
      .find((p) => attachment(p)?.authed && !attachment(p)?.paired);
    if (!phone) return close(ws, RELAY_CLOSE.peerClosed, 'the phone is gone');
    const phoneState = attachment(phone);
    if (!phoneState) return close(ws, RELAY_CLOSE.peerClosed, 'the phone is gone');
    const { deadline: _phoneDeadline, ...pairedPhone } = phoneState;
    const { deadline: _channelDeadline, ...pairedChannel } = state;
    phone.serializeAttachment({ ...pairedPhone, paired: true } satisfies SocketState);
    this.#markReady(ws, { ...pairedChannel, authed: true, paired: true });
    phone.send(JSON.stringify({ t: 'ready' }));
  }

  async #authPhone(
    ws: WebSocket,
    state: SocketState,
    key: string,
    sig: string,
    ticket: string | undefined,
  ): Promise<void> {
    if (!(await verify(key, sig, signingMessage(state)))) {
      return close(ws, RELAY_CLOSE.authFailed, 'bad signature');
    }
    let viaTicket = false;
    if (!this.#isAllowed(key)) {
      if (ticket === undefined || !this.#consumeTicket(await sha256Hex(ticket))) {
        return close(ws, RELAY_CLOSE.notAllowed, 'this phone is not paired with the bridge');
      }
      viaTicket = true;
    }
    const host = this.ctx
      .getWebSockets('host')
      .find((h) => h.readyState === WebSocket.READY_STATE_OPEN && attachment(h)?.authed);
    if (!host) return close(ws, RELAY_CLOSE.bridgeOffline, 'the bridge is not connected');
    ws.serializeAttachment({
      ...state,
      authed: true,
      key,
      ...(viaTicket ? { viaTicket } : {}),
      deadline: Date.now() + RELAY_DIAL_TIMEOUT_MS,
    } satisfies SocketState);
    host.send(JSON.stringify({ t: 'dial', channel: state.channel }));
    await this.#scheduleAlarm();
  }

  // --- state --------------------------------------------------------------

  #setAllowed(keys: string[]): void {
    this.#sql.exec(`DELETE FROM allowed`);
    for (const key of keys) this.#sql.exec(`INSERT INTO allowed (key) VALUES (?)`, key);
    // A revoked phone loses its live channel now, not at its next reconnect. A
    // phone still pairing on a ticket is not on the list yet and is left alone.
    for (const phone of this.ctx.getWebSockets('phone')) {
      const state = attachment(phone);
      if (!state?.authed || state.viaTicket || !state.key || keys.includes(state.key)) continue;
      close(phone, RELAY_CLOSE.revoked, 'revoked');
      for (const channel of this.ctx.getWebSockets(`c:${state.channel}`)) {
        close(channel, RELAY_CLOSE.revoked, 'revoked');
      }
    }
  }

  #isAllowed(key: string): boolean {
    return this.#sql.exec(`SELECT 1 FROM allowed WHERE key = ?`, key).toArray().length > 0;
  }

  /** Accepts an unexpired ticket once: it is deleted as it is used. */
  #consumeTicket(hash: string): boolean {
    const now = Date.now();
    const found =
      this.#sql.exec(`SELECT 1 FROM tickets WHERE hash = ? AND expires_at > ?`, hash, now).toArray()
        .length > 0;
    this.#sql.exec(`DELETE FROM tickets WHERE hash = ? OR expires_at <= ?`, hash, now);
    return found;
  }

  #meta(k: string): string | undefined {
    const row = this.#sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = ?`, k).toArray()[0];
    return row?.v;
  }

  #setMeta(k: string, v: string): void {
    this.#sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)`, k, v);
  }

  #markReady(ws: WebSocket, state: SocketState): void {
    const { deadline: _deadline, ...rest } = state;
    ws.serializeAttachment(rest satisfies SocketState);
    ws.send(JSON.stringify({ t: 'ready' }));
  }

  /** A phone or channel that goes away takes its other half with it. */
  #dropPeer(ws: WebSocket, code: number, reason: string): void {
    const state = attachment(ws);
    if (state?.channel !== undefined && state.route !== 'host') {
      const peerTag = state.route === 'phone' ? `c:${state.channel}` : `p:${state.channel}`;
      for (const peer of this.ctx.getWebSockets(peerTag)) {
        close(peer, RELAY_CLOSE.peerClosed, 'the other end closed');
      }
    }
    // Completes the closing handshake the peer started (the runtime expects
    // the handler to answer it), so this one bypasses the once-only guard.
    try {
      ws.close(isSendableCode(code) ? code : 1000, reason);
    } catch {
      // already closed
    }
  }

  /** Arms the alarm for the earliest socket deadline (or a ticket's expiry). */
  async #scheduleAlarm(): Promise<void> {
    let next: number | undefined;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      const deadline = attachment(ws)?.deadline;
      if (deadline !== undefined && (next === undefined || deadline < next)) next = deadline;
    }
    if (next === undefined) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || next < current) await this.ctx.storage.setAlarm(next);
  }
}

function attachment(ws: WebSocket): SocketState | undefined {
  return (ws.deserializeAttachment() as SocketState | null) ?? undefined;
}

function signingMessage(state: SocketState): string {
  return relaySigningMessage({
    route: state.route,
    host: state.host,
    routingId: state.routingId,
    ...(state.channel !== undefined && state.route === 'channel'
      ? { channelId: state.channel }
      : {}),
    nonce: state.nonce,
  });
}

/** Closes once: a socket already closing keeps the close it started. */
function close(ws: WebSocket, code: RelayCloseCode | number, reason: string): void {
  if (ws.readyState !== WebSocket.READY_STATE_OPEN) return;
  try {
    ws.close(code, reason);
  } catch {
    // raced with the peer's close
  }
}

/** The WebSocket API only lets an endpoint send 1000 or 3000–4999. */
function isSendableCode(code: number): boolean {
  return code === 1000 || (code >= 3000 && code <= 4999);
}

function parseHostKeys(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => /^[0-9a-f]{64}$/.test(k));
}

async function verify(keyHex: string, sigHex: string, message: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'Ed25519', false, [
      'verify',
    ]);
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(sigHex),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
