/**
 * Minimal mDNS / DNS-SD advertiser (RFC 6762 / 6763) — Phase 2 of manual-code
 * pairing. The bridge announces a `_uxnan._tcp.local` service on the LAN so the
 * phone can DISCOVER it (no typing the host); the user then enters the pairing
 * code shown on the PC and the phone calls `GET /pair/resolve?code=` (Phase 1).
 *
 * Deliberately dependency-free (hand-rolled over `node:dgram`): the bridge ships
 * as a global npm install / single binary, so we avoid a third-party mDNS stack
 * (no native build, no supply-chain surface). Scope is bounded — advertise ONE
 * service type and answer the standard browse queries; this is NOT a general mDNS
 * implementation.
 *
 * Records advertised (in response to a PTR browse, plus unsolicited announcements):
 *   - PTR  `_uxnan._tcp.local`            → `<instance>._uxnan._tcp.local`
 *   - SRV  `<instance>._uxnan._tcp.local` → 0 0 <port> `<host>.local`
 *   - TXT  `<instance>._uxnan._tcp.local` → v=1, id=<deviceId>, port=<port>, addr=<ip>
 *   - A    `<host>.local`                 → <ipv4>
 * The TXT carries `addr`/`port` too, so a phone can connect without resolving the
 * `.local` A record. On a multi-homed host, multicast membership and announcements
 * are bound explicitly to every advertised IPv4 so an OS route for a disconnected
 * or virtual NIC cannot hide the bridge from the phone. It is best-effort: a
 * failed bind/membership degrades safely — pairing still works by typing the host.
 *
 * Security: the advertisement carries only non-secret discovery hints (name,
 * port, device id). The pairing CODE is never advertised — it stays the consent
 * gate handed out on screen. See bridge/FOR-DEV.md.
 */
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import type { Logger } from '../logger.js';

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;
const SERVICE_TYPE_LABELS = ['_uxnan', '_tcp', 'local'];
const DNSSD_META_LABELS = ['_services', '_dns-sd', '_udp', 'local'];

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const CLASS_IN = 1;
const FLUSH = 0x8000; // cache-flush bit for unique records (A/SRV/TXT)
const DEFAULT_TTL = 120;

/** Minimal UDP socket surface the advertiser needs (so it can be faked in tests). */
export interface UdpSocketLike {
  on(event: 'message', listener: (msg: Buffer, rinfo: RemoteInfo) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  bind(options: { port: number; exclusive?: boolean }, callback?: () => void): void;
  addMembership(multicastAddress: string, multicastInterface?: string): void;
  setMulticastInterface(multicastInterface: string): void;
  setMulticastTTL(ttl: number): void;
  send(msg: Buffer, port: number, address: string, callback?: (err: Error | null) => void): void;
  close(callback?: () => void): void;
}

export interface MdnsAdvertiserOptions {
  /** Service instance name (the bridge display name; a single DNS-SD label). */
  instanceName: string;
  /** Host label for the A/SRV target (`<host>.local`); typically the machine name. */
  hostName: string;
  /** TCP port the LAN server listens on. */
  port: number;
  /** Non-internal IPv4 addresses to advertise (A records + TXT `addr`). */
  addresses: string[];
  /** Extra TXT key/values (e.g. `{ id: macDeviceId }`). */
  txt?: Record<string, string>;
  logger?: Logger;
  /** Socket factory (tests inject a fake). */
  socketFactory?: () => UdpSocketLike;
  /** How many unsolicited announcements to send on start (default 2). */
  announceCount?: number;
}

export class MdnsAdvertiser {
  readonly #opts: MdnsAdvertiserOptions;
  readonly #logger: Logger | undefined;
  #socket: UdpSocketLike | undefined;
  #joinedInterfaces: string[] = [];
  #started = false;

  constructor(options: MdnsAdvertiserOptions) {
    this.#opts = options;
    this.#logger = options.logger;
  }

  /** Bind, join the multicast group, announce, and answer browse queries. Best-effort. */
  start(): void {
    if (this.#started) return;
    try {
      const socket = (this.#opts.socketFactory ?? defaultSocketFactory)();
      this.#socket = socket;
      socket.on('error', (err) => {
        this.#logger?.warn(`mDNS socket error: ${err.message}`);
        this.stop();
      });
      socket.on('message', (msg) => this.#onMessage(msg));
      socket.bind({ port: MDNS_PORT, exclusive: false }, () => {
        const interfaces = [...new Set(this.#opts.addresses)];
        const joined: string[] = [];
        try {
          socket.setMulticastTTL(255);
        } catch (err) {
          this.#logger?.warn(`mDNS multicast TTL failed: ${errMsg(err)}`);
        }
        // Joining/sending without an explicit interface lets the OS choose one.
        // On multi-homed Windows hosts the lowest-metric multicast route may be
        // a disconnected Ethernet NIC, Tailscale, Hyper-V or WSL rather than the
        // Wi-Fi interface shared with the phone. Join every advertised IPv4 and
        // emit the packet once through each successful membership instead.
        for (const address of interfaces) {
          try {
            socket.addMembership(MDNS_ADDRESS, address);
            joined.push(address);
          } catch (err) {
            this.#logger?.warn(`mDNS membership failed on ${address}: ${errMsg(err)}`);
          }
        }
        if (joined.length === 0) {
          try {
            socket.addMembership(MDNS_ADDRESS);
          } catch (err) {
            this.#logger?.warn(`mDNS membership failed on the default interface: ${errMsg(err)}`);
          }
        }
        this.#joinedInterfaces = joined;
        const route = joined.length > 0 ? joined.join(', ') : 'the OS default interface';
        this.#logger?.info(`mDNS advertising _uxnan._tcp on :${this.#opts.port} via ${route}`);
        this.#announce();
      });
      this.#started = true;
    } catch (err) {
      this.#logger?.warn(`mDNS advertise disabled: ${errMsg(err)}`);
    }
  }

  /** Send a goodbye (TTL 0) and close. Best-effort. */
  stop(): void {
    const socket = this.#socket;
    if (!socket) return;
    this.#socket = undefined;
    this.#started = false;
    const joinedInterfaces = this.#joinedInterfaces;
    this.#joinedInterfaces = [];
    try {
      this.#sendPacket(socket, this.#buildResponse(0), joinedInterfaces, () => socket.close());
    } catch {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
  }

  #announce(): void {
    const times = this.#opts.announceCount ?? 2;
    for (let i = 0; i < times; i += 1) this.#sendResponse();
  }

  #onMessage(msg: Buffer): void {
    let questions: Question[];
    try {
      questions = parseQuestions(msg);
    } catch {
      return;
    }
    // Respond if any question targets our service type, the DNS-SD meta-query, our
    // instance, or our host record.
    const wantsUs = questions.some((q) => {
      const n = q.labels;
      return (
        labelsEqual(n, SERVICE_TYPE_LABELS) ||
        labelsEqual(n, DNSSD_META_LABELS) ||
        labelsEqual(n, this.#instanceLabels()) ||
        labelsEqual(n, this.#hostLabels())
      );
    });
    if (wantsUs) this.#sendResponse();
  }

  #sendResponse(): void {
    const socket = this.#socket;
    if (!socket) return;
    this.#sendPacket(socket, this.#buildResponse(DEFAULT_TTL), this.#joinedInterfaces);
  }

  #sendPacket(
    socket: UdpSocketLike,
    packet: Buffer,
    interfaces: string[],
    onComplete?: () => void,
  ): void {
    const targets: Array<string | undefined> = interfaces.length > 0 ? interfaces : [undefined];
    let pending = targets.length;
    const completeOne = () => {
      pending -= 1;
      if (pending === 0) onComplete?.();
    };
    for (const address of targets) {
      try {
        if (address) socket.setMulticastInterface(address);
        socket.send(packet, MDNS_PORT, MDNS_ADDRESS, (err) => {
          if (err) {
            const route = address ? ` via ${address}` : '';
            this.#logger?.warn(`mDNS send failed${route}: ${err.message}`);
          }
          completeOne();
        });
      } catch (err) {
        const route = address ? ` via ${address}` : '';
        this.#logger?.warn(`mDNS send failed${route}: ${errMsg(err)}`);
        completeOne();
      }
    }
  }

  #instanceLabels(): string[] {
    return [this.#opts.instanceName, ...SERVICE_TYPE_LABELS];
  }

  #hostLabels(): string[] {
    return [this.#opts.hostName, 'local'];
  }

  /** Build the full announcement/response message (PTR + SRV + TXT + A). */
  #buildResponse(ttl: number): Buffer {
    const instance = this.#instanceLabels();
    const host = this.#hostLabels();
    const txt = {
      v: '1',
      port: String(this.#opts.port),
      ...(this.#opts.addresses[0] ? { addr: this.#opts.addresses[0] } : {}),
      ...this.#opts.txt,
    };
    const records: ResourceRecord[] = [
      {
        labels: SERVICE_TYPE_LABELS,
        type: TYPE_PTR,
        flush: false,
        ttl,
        rdata: encodeName(instance),
      },
      {
        labels: instance,
        type: TYPE_SRV,
        flush: true,
        ttl,
        rdata: encodeSrv(0, 0, this.#opts.port, host),
      },
      { labels: instance, type: TYPE_TXT, flush: true, ttl, rdata: encodeTxt(txt) },
      ...this.#opts.addresses.map((addr) => ({
        labels: host,
        type: TYPE_A,
        flush: true,
        ttl,
        rdata: encodeIPv4(addr),
      })),
    ];
    return buildMessage(records);
  }
}

function defaultSocketFactory(): UdpSocketLike {
  return createSocket({ type: 'udp4', reuseAddr: true }) as unknown as Socket as UdpSocketLike;
}

// --- DNS wire format (minimal, no name compression) --------------------------

interface Question {
  labels: string[];
  type: number;
}

interface ResourceRecord {
  labels: string[];
  type: number;
  flush: boolean;
  ttl: number;
  rdata: Buffer;
}

/** Encode a domain name as a sequence of length-prefixed labels + a 0 terminator. */
export function encodeName(labels: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, 'utf-8');
    if (bytes.length > 63) throw new Error('label too long');
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function encodeSrv(priority: number, weight: number, port: number, target: string[]): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16BE(priority, 0);
  head.writeUInt16BE(weight, 2);
  head.writeUInt16BE(port, 4);
  return Buffer.concat([head, encodeName(target)]);
}

function encodeTxt(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(entries)) {
    const s = Buffer.from(`${key}=${value}`, 'utf-8');
    parts.push(Buffer.from([Math.min(s.length, 255)]), s.subarray(0, 255));
  }
  if (parts.length === 0) parts.push(Buffer.from([0])); // empty TXT = one zero-length string
  return Buffer.concat(parts);
}

function encodeIPv4(address: string): Buffer {
  const octets = address.split('.').map((o) => Number.parseInt(o, 10));
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    throw new Error(`bad IPv4: ${address}`);
  }
  return Buffer.from(octets);
}

/** Build an mDNS response message (QR=1, AA=1) carrying the given answer records. */
export function buildMessage(records: ResourceRecord[]): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // ID
  header.writeUInt16BE(0x8400, 2); // flags: QR + AA
  header.writeUInt16BE(0, 4); // QDCOUNT
  header.writeUInt16BE(records.length, 6); // ANCOUNT
  const body: Buffer[] = [header];
  for (const rr of records) {
    const name = encodeName(rr.labels);
    const meta = Buffer.alloc(10);
    meta.writeUInt16BE(rr.type, 0);
    meta.writeUInt16BE(CLASS_IN | (rr.flush ? FLUSH : 0), 2);
    meta.writeUInt32BE(rr.ttl, 4);
    meta.writeUInt16BE(rr.rdata.length, 8);
    body.push(name, meta, rr.rdata);
  }
  return Buffer.concat(body);
}

/** Parse just the question section of a DNS message into label arrays + qtype. */
export function parseQuestions(msg: Buffer): Question[] {
  if (msg.length < 12) return [];
  const qd = msg.readUInt16BE(4);
  let offset = 12;
  const questions: Question[] = [];
  for (let i = 0; i < qd; i += 1) {
    const { labels, next } = readName(msg, offset);
    offset = next;
    if (offset + 4 > msg.length) break;
    const type = msg.readUInt16BE(offset);
    offset += 4; // type(2) + class(2)
    questions.push({ labels, type });
  }
  return questions;
}

/** Read a (possibly compressed) domain name; returns labels + the offset after it. */
function readName(msg: Buffer, start: number): { labels: string[]; next: number } {
  const labels: string[] = [];
  let offset = start;
  let next = -1;
  let guard = 0;
  for (;;) {
    if (guard++ > 128 || offset >= msg.length) break;
    const len = msg[offset]!;
    if (len === 0) {
      offset += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      // compression pointer (2 bytes); the name continues at the pointed offset
      if (next === -1) next = offset + 2;
      offset = ((len & 0x3f) << 8) | msg[offset + 1]!;
      continue;
    }
    labels.push(msg.toString('utf-8', offset + 1, offset + 1 + len));
    offset += 1 + len;
  }
  return { labels, next: next === -1 ? offset : next };
}

function labelsEqual(a: string[], b: string[]): boolean {
  return (
    a.length === b.length && a.every((label, i) => label.toLowerCase() === b[i]!.toLowerCase())
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
