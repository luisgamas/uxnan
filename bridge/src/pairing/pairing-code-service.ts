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
 * The code is a **consent gate**: only someone who can read the PC screen learns
 * it, so a random LAN device cannot pull the payload and pair — and, because a
 * successful {@link resolve} also arms the bootstrap window, proving the code is
 * what lets the handshake through on a daemon the operator cannot type into. This
 * is the same
 * trust posture as the QR (whoever sees the screen can pair) — the code adds no
 * new secret beyond what the QR already exposes. Brute force is bounded by the
 * code entropy (40 bits), a short TTL, and per-IP rate limiting.
 *
 * Security note: the payload itself is not the only gate — completing the
 * identity-keyed E2EE handshake also requires the LAN/Tailscale
 * `qr_bootstrap` bootstrap to happen while this service is **armed** (see
 * below). Without that additional gate, the handshake alone verifies only the
 * phone's OWN transcript signature (an attacker signs that with their own
 * key), so a device that never touched `/pair/resolve` at all — one that
 * merely reaches the always-listening LAN socket — could otherwise self-enroll
 * as trusted at any time. See bridge/FOR-DEV.md for the deferred proof-of-code
 * hardening that would close the remaining gap (any device reachable *during*
 * the window still qualifies).
 *
 * **Armed pairing window**: the LAN/Tailscale handshake (`server-handshake.ts`)
 * requires this service to be "armed" before it accepts a `qr_bootstrap`
 * bootstrap — see {@link arm}/{@link isArmed}. Three operator actions arm it:
 * showing the QR or the manual code (`Bridge.generatePairingQr` /
 * `currentPairingCode`) and a successful {@link resolve} — producing the current
 * code proves it was read off the PC, and it is the only one of the three that
 * reaches a separately-running, console-less daemon. The window confines
 * bootstrap acceptance to the short span right after the operator asked to pair
 * a phone. `trusted_reconnect` never consults this.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MAX_PAIRING_AGE_MS, type PairingPayload } from '@uxnan/shared';

/** Crockford base32 alphabet (no I, L, O, U — unambiguous when read aloud/typed). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_RATE_MAX = 10; // attempts per window per IP
const DEFAULT_RATE_MAX_KEYS = 10_000; // distinct-IP entries tracked before oldest is evicted

/**
 * How long a LAN `qr_bootstrap` handshake is accepted after an operator action
 * opens the window (see {@link PairingCodeService.arm}). Deliberately the SAME
 * span the phone already applies to a `PairingPayload` (`MAX_PAIRING_AGE_MS`):
 * a gate that expired before the artifact it gates would leave a dead band where
 * the phone accepts the QR and the bridge silently refuses the handshake.
 */
export const PAIRING_WINDOW_MS = MAX_PAIRING_AGE_MS;

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
  /**
   * Hard cap on distinct-IP rate-limit entries tracked at once. Bounds memory
   * against an attacker rotating source addresses — trivial over an allocated
   * IPv6 /64 — which would otherwise grow the rate-limit map by one entry per
   * new address forever. The oldest entry is evicted once at capacity; a
   * single IP's own throttling budget is unaffected. Default 10,000.
   */
  rateMaxKeys?: number;
  /**
   * Absolute path to persist the current code+expiry (e.g.
   * `~/.uxnan/pairing-code.json`). When set, the code is shared ACROSS processes
   * so the running daemon that serves `/pair/resolve` and a separate `qr`/`code`
   * command (or an autostarted, console-less daemon) hand out the SAME code.
   * Omit for an in-memory-only instance (tests).
   */
  statePath?: string;
}

/** On-disk shape of the shared pairing code. */
interface PersistedCode {
  code: string;
  expiresAt: number;
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
  readonly #rateMaxKeys: number;
  readonly #rate = new Map<string, RateEntry>();
  readonly #statePath: string | undefined;

  #code: string | undefined;
  #expiresAt = 0;
  /**
   * End of the current armed pairing window (epoch ms), or 0 when never armed.
   * In-memory only and per-instance by design: a bridge restart re-requires
   * arming rather than silently reopening the window. A separate short-lived
   * `qr`/`code` CLI invocation only arms itself, which is why {@link resolve}
   * also arms — that is the path a console-less daemon is reached through.
   */
  #armedUntil = 0;

  constructor(options: PairingCodeServiceOptions) {
    this.#buildPayload = options.buildPayload;
    this.#now = options.now ?? (() => Date.now());
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#generateCode = options.generateCode ?? defaultGenerateCode;
    this.#rateWindowMs = options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS;
    this.#rateMax = options.rateMax ?? DEFAULT_RATE_MAX;
    this.#rateMaxKeys = options.rateMaxKeys ?? DEFAULT_RATE_MAX_KEYS;
    this.#statePath = options.statePath;
  }

  /** Number of distinct-IP rate-limit entries tracked (bounded by `rateMaxKeys`); exposed for tests. */
  get rateEntryCount(): number {
    return this.#rate.size;
  }

  /**
   * The current pairing code, (re)issued if none exists or the previous one
   * expired. Display this on the PC for the user to type on the phone. Returned
   * grouped (`ABCD-EFGH`) for readability; {@link resolve} accepts either form.
   */
  currentCode(): string {
    const now = this.#now();
    this.#syncFromDisk(now);
    if (!this.#code || now >= this.#expiresAt) {
      this.#code = this.#generateCode();
      this.#expiresAt = now + this.#ttlMs;
      this.#persist();
    }
    return group(this.#code);
  }

  /** Force a fresh code now (e.g. the user asked to regenerate). */
  rotate(): string {
    this.#code = this.#generateCode();
    this.#expiresAt = this.#now() + this.#ttlMs;
    this.#persist();
    return group(this.#code);
  }

  /**
   * Validate a code presented by a phone and, if it matches the active
   * (unexpired) code, return the pairing payload. Comparison is constant-time and
   * input is normalized (case, grouping, Crockford look-alikes). A match also
   * {@link arm}s the bootstrap window; a miss changes nothing.
   */
  resolve(code: string): PairingPayload | undefined {
    const now = this.#now();
    // Re-read the shared code so a daemon serving `/pair/resolve` validates
    // against the code another process (the `qr`/`code` command) may have issued.
    this.#syncFromDisk(now);
    if (!this.#code || now >= this.#expiresAt) return undefined;
    if (!constantTimeEqual(normalize(code), this.#code)) return undefined;
    // A caller that produced the current code proved it was read off the PC —
    // that IS the operator action the bootstrap gate looks for, so a successful
    // resolve arms the window. Without this, pairing against an autostarted,
    // console-less daemon is impossible: `qr`/`code` run in a SEPARATE process
    // and share the code through disk, but cannot arm the daemon that actually
    // serves the handshake. See {@link arm}.
    this.arm();
    return this.#buildPayload();
  }

  /** Adopt the persisted (shared) code when present and still valid. */
  #syncFromDisk(now: number): void {
    const persisted = this.#load();
    if (persisted && now < persisted.expiresAt) {
      this.#code = persisted.code;
      this.#expiresAt = persisted.expiresAt;
    }
  }

  /** Read the shared code from disk, or `undefined` (no path / missing / corrupt). */
  #load(): PersistedCode | undefined {
    if (!this.#statePath) return undefined;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#statePath, 'utf-8'));
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as PersistedCode).code === 'string' &&
        typeof (parsed as PersistedCode).expiresAt === 'number'
      ) {
        return {
          code: (parsed as PersistedCode).code,
          expiresAt: (parsed as PersistedCode).expiresAt,
        };
      }
    } catch {
      /* missing or corrupt → in-memory only */
    }
    return undefined;
  }

  /** Persist the current code so other processes hand out the same one. Best-effort. */
  #persist(): void {
    if (!this.#statePath || !this.#code) return;
    try {
      mkdirSync(dirname(this.#statePath), { recursive: true });
      writeFileSync(
        this.#statePath,
        JSON.stringify({ code: this.#code, expiresAt: this.#expiresAt }),
      );
    } catch {
      /* best-effort: persistence failure falls back to in-memory */
    }
  }

  /**
   * Open the pairing window: from now, a LAN `qr_bootstrap` handshake is
   * accepted for {@link PAIRING_WINDOW_MS}. Called at each operator action that
   * proves "I am pairing a phone right now" — showing a QR or the manual code
   * on the PC, or a successful {@link resolve} of the current code (which only
   * a caller that read the code off the PC can produce). That is the signal the
   * LAN handshake gates on (see `server-handshake.ts`). Idempotent-ish: calling
   * it again just extends the window from the new `now`.
   */
  arm(): void {
    this.#armedUntil = this.#now() + PAIRING_WINDOW_MS;
  }

  /** Whether a LAN `qr_bootstrap` handshake is currently allowed (see {@link arm}). */
  isArmed(): boolean {
    return this.#now() < this.#armedUntil;
  }

  /**
   * Record a resolve attempt from `ip` and report whether it is now over the
   * limit (the caller should answer 429 and NOT call {@link resolve}).
   */
  rateLimited(ip: string): boolean {
    const now = this.#now();
    const entry = this.#rate.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.#sweepRate(now);
      this.#evictRateIfFull(ip);
      this.#rate.set(ip, { count: 1, resetAt: now + this.#rateWindowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > this.#rateMax;
  }

  /** Drop rate-limit entries whose window has already elapsed. */
  #sweepRate(now: number): void {
    for (const [ip, entry] of this.#rate) {
      if (now >= entry.resetAt) this.#rate.delete(ip);
    }
  }

  /**
   * Hard backstop against unbounded growth from IP rotation: evict the
   * oldest-inserted entry once at capacity. `Map` preserves insertion order.
   */
  #evictRateIfFull(nextIp: string): void {
    if (this.#rate.size < this.#rateMaxKeys || this.#rate.has(nextIp)) return;
    const oldest = this.#rate.keys().next().value;
    if (oldest !== undefined) this.#rate.delete(oldest);
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
