/**
 * Sliding-window buffer of outbound (bridge → phone) messages held while no
 * session is active, so they can be flushed on (re)connect.
 *
 * Caps follow the spec (architecture/02a §5.9.2): at most
 * MAX_BRIDGE_OUTBOUND_MESSAGES messages and MAX_BRIDGE_OUTBOUND_BYTES total;
 * the oldest entries are dropped first. At least one message is always kept.
 */
import { MAX_BRIDGE_OUTBOUND_BYTES, MAX_BRIDGE_OUTBOUND_MESSAGES } from '@uxnan/shared';

interface BufferedMessage {
  message: unknown;
  bytes: number;
}

export class OutboundMessageBuffer {
  readonly #queue: BufferedMessage[] = [];
  readonly #maxMessages: number;
  readonly #maxBytes: number;
  #totalBytes = 0;

  constructor(
    maxMessages: number = MAX_BRIDGE_OUTBOUND_MESSAGES,
    maxBytes: number = MAX_BRIDGE_OUTBOUND_BYTES,
  ) {
    this.#maxMessages = maxMessages;
    this.#maxBytes = maxBytes;
  }

  enqueue(message: unknown): void {
    const bytes = Buffer.byteLength(JSON.stringify(message), 'utf-8');
    this.#queue.push({ message, bytes });
    this.#totalBytes += bytes;
    while (
      this.#queue.length > this.#maxMessages ||
      (this.#totalBytes > this.#maxBytes && this.#queue.length > 1)
    ) {
      const evicted = this.#queue.shift();
      if (!evicted) break;
      this.#totalBytes -= evicted.bytes;
    }
  }

  /** Remove and return all buffered messages, in FIFO order. */
  drainAll(): unknown[] {
    const items = this.#queue.map((entry) => entry.message);
    this.#queue.length = 0;
    this.#totalBytes = 0;
    return items;
  }

  get length(): number {
    return this.#queue.length;
  }

  get byteLength(): number {
    return this.#totalBytes;
  }
}
