import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import {
  parseRelayServerFrame,
  relayRoutePath,
  relaySigningMessage,
  type RelayRoute,
} from '@uxnan/shared/relay';

export interface Identity {
  publicKeyHex: string;
  privateKey: KeyObject;
}

export function newIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { publicKeyHex: Buffer.from(jwk.x ?? '', 'base64url').toString('hex'), privateKey };
}

/** An identity from a PKCS#8 PEM (to act as a host a deployed relay trusts). */
export function identityFromPem(pem: string): Identity {
  const privateKey = createPrivateKey(pem);
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  return { publicKeyHex: Buffer.from(jwk.x ?? '', 'base64url').toString('hex'), privateKey };
}

export function newRelayId(): string {
  return randomBytes(16).toString('hex');
}

export function signHex(identity: Identity, message: string): string {
  return sign(null, Buffer.from(message, 'utf8'), identity.privateKey).toString('hex');
}

export type Event =
  | { kind: 'frame'; data: Buffer; isBinary: boolean }
  | { kind: 'close'; code: number; reason: string };

/** A WebSocket with a queue of everything it received, in order. */
export class Client {
  readonly ws: WebSocket;
  readonly #events: Event[] = [];
  readonly #waiters: ((e: Event) => void)[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data: RawData, isBinary: boolean) =>
      this.#push({ kind: 'frame', data: toBuffer(data), isBinary }),
    );
    ws.on('close', (code, reason) =>
      this.#push({ kind: 'close', code, reason: reason.toString() }),
    );
  }

  static open(url: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new Client(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  #push(e: Event): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter(e);
    else this.#events.push(e);
  }

  next(timeoutMs = 15_000): Promise<Event> {
    const queued = this.#events.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for an event')),
        timeoutMs,
      );
      this.#waiters.push((e) => {
        clearTimeout(timer);
        resolve(e);
      });
    });
  }

  async nextControl(): Promise<ReturnType<typeof parseRelayServerFrame>> {
    const e = await this.next();
    if (e.kind !== 'frame') throw new Error(`expected a frame, got close ${e.code} ${e.reason}`);
    return parseRelayServerFrame(e.data.toString('utf8'));
  }

  /**
   * Waits until the relay closes this socket with `code`. Counts the close as
   * received as soon as its close FRAME arrives: when the local runtime closes
   * a socket from a Durable Object alarm it sends the frame but keeps the TCP
   * connection until disposal, so `ws` would only emit `close` after its 30 s
   * close timeout. (Cloudflare's edge ends the connection promptly — verified
   * against a deployed relay.)
   */
  async expectClose(code: number, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const queued = this.#events.find((e) => e.kind === 'close');
      if (queued?.kind === 'close') return assertCode(code, queued.code, queued.reason);
      const internals = this.ws as unknown as {
        _closeFrameReceived?: boolean;
        _closeCode?: number;
      };
      if (internals._closeFrameReceived) return assertCode(code, internals._closeCode ?? 0, '');
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for close ${code}`);
  }

  sendJson(value: unknown): void {
    this.ws.send(JSON.stringify(value));
  }

  close(): void {
    this.ws.close();
  }
}

function assertCode(expected: number, got: number, reason: string): void {
  if (got !== expected) throw new Error(`expected close ${expected}, got ${got} (${reason})`);
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/** Opens a route and answers the challenge; returns the client before `ready`. */
export async function connectAndAuth(options: {
  relayUrl: string;
  route: RelayRoute;
  routingId: string;
  channelId?: string;
  identity: Identity;
  /** Phone only. */
  ticket?: string;
  /** Sign with this identity instead (to forge a bad signature). */
  signWith?: Identity;
}): Promise<Client> {
  const path = relayRoutePath(options.route, options.routingId, options.channelId);
  const client = await Client.open(`${options.relayUrl}${path}`);
  const challenge = await client.nextControl();
  if (challenge?.t !== 'challenge') throw new Error('expected a challenge');
  const host = new URL(options.relayUrl).host;
  const message = relaySigningMessage({
    route: options.route,
    host,
    routingId: options.routingId,
    ...(options.route === 'channel' && options.channelId ? { channelId: options.channelId } : {}),
    nonce: challenge.nonce,
  });
  const sig = signHex(options.signWith ?? options.identity, message);
  if (options.route === 'host') {
    client.sendJson({ t: 'host-auth', key: options.identity.publicKeyHex, sig });
  } else if (options.route === 'channel') {
    client.sendJson({ t: 'channel-auth', sig });
  } else {
    client.sendJson({
      t: 'phone-auth',
      key: options.identity.publicKeyHex,
      sig,
      ...(options.ticket ? { ticket: options.ticket } : {}),
    });
  }
  return client;
}
