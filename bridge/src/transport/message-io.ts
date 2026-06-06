/**
 * Transport-agnostic binary message channel. Both the relay client and the LAN
 * server adapt their WebSocket to this interface so the secure session logic is
 * written once.
 *
 * Frames are raw bytes: UTF-8 JSON for handshake control messages and encrypted
 * envelopes (matching the mobile app, which sends binary frames).
 */

export interface MessageIO {
  /** Send a binary frame. */
  send(bytes: Buffer): void;
  /** Register an inbound-frame listener. */
  onMessage(listener: (bytes: Buffer) => void): void;
  /** Register a close listener. */
  onClose(listener: () => void): void;
  /** Close the underlying channel. */
  close(): void;
}

/**
 * An async FIFO over inbound frames. `next()` resolves with the next frame or
 * rejects once the channel is closed and drained. Used to drive the request/
 * response handshake sequentially.
 */
export class MessageQueue {
  readonly #buffer: Buffer[] = [];
  readonly #waiters: { resolve: (b: Buffer) => void; reject: (e: Error) => void }[] = [];
  #closed = false;

  push(bytes: Buffer): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve(bytes);
    } else {
      this.#buffer.push(bytes);
    }
  }

  close(): void {
    this.#closed = true;
    while (this.#waiters.length > 0) {
      this.#waiters.shift()!.reject(new Error('message channel closed'));
    }
  }

  next(): Promise<Buffer> {
    const buffered = this.#buffer.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.#closed) return Promise.reject(new Error('message channel closed'));
    return new Promise<Buffer>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }
}

/** Attach a {@link MessageQueue} to a {@link MessageIO}. */
export function queueFor(io: MessageIO): MessageQueue {
  const queue = new MessageQueue();
  io.onMessage((bytes) => queue.push(bytes));
  io.onClose(() => queue.close());
  return queue;
}

/** Create a connected in-memory pair of {@link MessageIO}s (for tests). */
export function createInMemoryIoPair(): [MessageIO, MessageIO] {
  const listeners: { a: ((b: Buffer) => void)[]; b: ((b: Buffer) => void)[] } = { a: [], b: [] };
  const closers: { a: (() => void)[]; b: (() => void)[] } = { a: [], b: [] };
  let open = true;

  const closeBoth = (): void => {
    if (!open) return;
    open = false;
    for (const c of closers.a) c();
    for (const c of closers.b) c();
  };

  const a: MessageIO = {
    send: (bytes) => {
      if (open) for (const l of listeners.b) l(bytes);
    },
    onMessage: (l) => listeners.a.push(l),
    onClose: (l) => closers.a.push(l),
    close: closeBoth,
  };
  const b: MessageIO = {
    send: (bytes) => {
      if (open) for (const l of listeners.a) l(bytes);
    },
    onMessage: (l) => listeners.b.push(l),
    onClose: (l) => closers.b.push(l),
    close: closeBoth,
  };
  return [a, b];
}
