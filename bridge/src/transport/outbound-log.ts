/**
 * Per-device outbound (bridge → phone) log: assigns every bridge→phone payload a
 * continuous, monotonic `seq` and retains the recent plaintext in a sliding
 * window so it can be REPLAYED after a reconnect (seq-based catch-up).
 *
 * Why plaintext (not encrypted envelopes): every reconnect derives a FRESH
 * session key (X25519 ephemeral handshake), so retained envelopes encrypted
 * under the previous key are useless to the new channel. The log keeps the
 * plaintext + its seq; on reconnect the new channel re-encrypts the entries the
 * phone is missing (`encryptReplay`).
 *
 * The `seq` counter is owned HERE (not by the per-connection channel) precisely
 * so it survives a reconnect: a new `BridgeSecureChannel` built over the same
 * log continues the sequence instead of restarting at 1.
 *
 * Caps follow the spec (architecture/02a §5.9.2): at most
 * MAX_BRIDGE_OUTBOUND_MESSAGES messages and MAX_BRIDGE_OUTBOUND_BYTES total; the
 * oldest entries are evicted first. At least one message is always kept. When
 * the phone's `lastAppliedBridgeOutboundSeq` predates the oldest retained entry
 * (the bridge already evicted it, or restarted and lost the log), those messages
 * are unrecoverable here — the phone falls back to `turn/list` re-sync.
 */
import { MAX_BRIDGE_OUTBOUND_BYTES, MAX_BRIDGE_OUTBOUND_MESSAGES } from '@uxnan/shared';

/** A retained outbound message: its sequence number and the plaintext bytes. */
export interface OutboundLogEntry {
  seq: number;
  plaintext: Buffer;
}

interface RetainedEntry extends OutboundLogEntry {
  bytes: number;
}

export class OutboundLog {
  readonly #entries: RetainedEntry[] = [];
  readonly #maxMessages: number;
  readonly #maxBytes: number;
  #totalBytes = 0;
  /** Next sequence number to hand out (1-based, never reset across reconnects). */
  #nextSeq = 1;

  constructor(
    maxMessages: number = MAX_BRIDGE_OUTBOUND_MESSAGES,
    maxBytes: number = MAX_BRIDGE_OUTBOUND_BYTES,
  ) {
    this.#maxMessages = maxMessages;
    this.#maxBytes = maxBytes;
  }

  /**
   * Assign the next `seq` to a plaintext payload, retain it in the window, and
   * return the assigned seq. Called for EVERY bridge→phone message (replies and
   * notifications), whether sent live or buffered while offline.
   */
  record(plaintext: Buffer): number {
    const seq = this.#nextSeq;
    this.#nextSeq += 1;
    const bytes = plaintext.byteLength;
    this.#entries.push({ seq, plaintext, bytes });
    this.#totalBytes += bytes;
    while (
      this.#entries.length > this.#maxMessages ||
      (this.#totalBytes > this.#maxBytes && this.#entries.length > 1)
    ) {
      const evicted = this.#entries.shift();
      if (!evicted) break;
      this.#totalBytes -= evicted.bytes;
    }
    return seq;
  }

  /**
   * Retained entries with `seq` strictly greater than `lastAppliedSeq`, oldest
   * first — i.e. exactly what the phone is missing and must be replayed.
   */
  entriesAfter(lastAppliedSeq: number): OutboundLogEntry[] {
    const out: OutboundLogEntry[] = [];
    for (const entry of this.#entries) {
      if (entry.seq > lastAppliedSeq) out.push({ seq: entry.seq, plaintext: entry.plaintext });
    }
    return out;
  }

  /** The seq that the next `record` will assign. */
  get nextSeq(): number {
    return this.#nextSeq;
  }

  get length(): number {
    return this.#entries.length;
  }

  get byteLength(): number {
    return this.#totalBytes;
  }
}
