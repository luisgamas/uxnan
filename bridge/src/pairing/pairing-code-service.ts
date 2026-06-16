/**
 * Manual-code pairing (bridge-side; architecture §5.10.1 reframed for the
 * bridge-first model — the relay's `/trusted-session/resolve` was the off-LAN
 * equivalent).
 *
 * The bridge shows a short, rotating **pairing code** on the PC (CLI / desktop).
 * A phone that has located the bridge on the LAN (via mDNS discovery — a later
 * slice — or by typing the host) calls `GET /pair/resolve?code=<code>` on the LAN
 * server; this service validates the code and hands back the full
 * {@link PairingPayload} (the same data the QR carries), which the phone then runs
 * through the normal E2EE handshake.
 *
 * The code is the **consent gate**: only someone who can read the PC screen learns
 * it, so a random LAN device cannot pull the payload and pair. This is the same
 * trust posture as the QR (whoever sees the screen can pair) — the code adds no
 * new secret beyond what the QR already exposes. Brute force is bounded by the
 * code entropy (40 bits), a short TTL, and per-IP rate limiting.
 *
 * Security note: the payload is not a secret that grants access on its own — the
 * phone must still complete the identity-keyed E2EE handshake. See bridge/FOR-DEV.md.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PairingPayload } from '@uxnan/shared';

/** Crockford base32 alphabet (no I, L, O, U — unambiguous when read aloud/typed). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_RATE_MAX = 10; // attempts per window per IP

export interface PairingCodeServiceOptions {
  /** Builds the payload handed out on a valid code (the bridge's pairing data). */
  buildPayload: () => PairingPayload;
  /** Injected clock (epoch ms) for testability. */
  now?: () => number;
  /** Code lifetime before it rotates (default 10 min). */
  ttlMs?: number;
  /** Injected code generator (tests); defaults to an 8-char base32 code. */
  generateCode?: () => string;
  /** Per-IP resolve-attempt window + cap (anti-brute-force). */
  rateWindowMs?: number;
  rateMax?: number;
}

interface RateEntry {
  count: number;
  resetAt: number;
}

export class PairingCodeService {
  readonly #buildPayload: () => PairingPayload;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #generateCode: () => string;
  readonly #rateWindowMs: number;
  readonly #rateMax: number;
  readonly #rate = new Map<string, RateEntry>();

  #code: string | undefined;
  #expiresAt = 0;

  constructor(options: PairingCodeServiceOptions) {
    this.#buildPayload = options.buildPayload;
    this.#now = options.now ?? (() => Date.now());
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#generateCode = options.generateCode ?? defaultGenerateCode;
    this.#rateWindowMs = options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS;
    this.#rateMax = options.rateMax ?? DEFAULT_RATE_MAX;
  }

  /**
   * The current pairing code, (re)issued if none exists or the previous one
   * expired. Display this on the PC for the user to type on the phone. Returned
   * grouped (`ABCD-EFGH`) for readability; {@link resolve} accepts either form.
   */
  currentCode(): string {
    const now = this.#now();
    if (!this.#code || now >= this.#expiresAt) {
      this.#code = this.#generateCode();
      this.#expiresAt = now + this.#ttlMs;
    }
    return group(this.#code);
  }

  /** Force a fresh code now (e.g. the user asked to regenerate). */
  rotate(): string {
    this.#code = this.#generateCode();
    this.#expiresAt = this.#now() + this.#ttlMs;
    return group(this.#code);
  }

  /**
   * Validate a code presented by a phone and, if it matches the active
   * (unexpired) code, return the pairing payload. Comparison is constant-time and
   * input is normalized (case, grouping, Crockford look-alikes).
   */
  resolve(code: string): PairingPayload | undefined {
    const now = this.#now();
    if (!this.#code || now >= this.#expiresAt) return undefined;
    if (!constantTimeEqual(normalize(code), this.#code)) return undefined;
    return this.#buildPayload();
  }

  /**
   * Record a resolve attempt from `ip` and report whether it is now over the
   * limit (the caller should answer 429 and NOT call {@link resolve}).
   */
  rateLimited(ip: string): boolean {
    const now = this.#now();
    const entry = this.#rate.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.#rate.set(ip, { count: 1, resetAt: now + this.#rateWindowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > this.#rateMax;
  }
}

/** Generate an 8-char Crockford-base32 code from 40 bits of entropy. */
function defaultGenerateCode(): string {
  const bytes = randomBytes(5); // 40 bits → 8 base32 chars
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  return out.slice(0, 8);
}

/** Group an 8-char code as `ABCD-EFGH` for display. */
function group(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * Normalize a user-typed code: uppercase, strip non-alphanumerics (dashes/spaces),
 * and fold Crockford look-alikes (O→0, I/L→1) so a misread is still accepted.
 */
function normalize(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Constant-time string compare that never throws on length mismatch. */
function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
