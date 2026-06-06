/**
 * Tracks the live encrypted sink for each connected phone so the bridge can push
 * JSON-RPC notifications (e.g. streamed agent events) to it. Messages sent while
 * a device has no active session are buffered and flushed on (re)connect.
 */
import { OutboundMessageBuffer } from './outbound-buffer.js';

/** Encrypts a JSON-RPC message and writes it to the active connection. */
export interface SessionSink {
  send(message: unknown): void;
}

export class SessionRegistry {
  readonly #sinks = new Map<string, SessionSink>();
  readonly #buffers = new Map<string, OutboundMessageBuffer>();

  /** Register the active sink for a device and flush any buffered messages. */
  register(deviceId: string, sink: SessionSink): void {
    this.#sinks.set(deviceId, sink);
    const buffer = this.#buffers.get(deviceId);
    if (buffer) {
      for (const message of buffer.drainAll()) {
        sink.send(message);
      }
      this.#buffers.delete(deviceId);
    }
  }

  unregister(deviceId: string): void {
    this.#sinks.delete(deviceId);
  }

  isActive(deviceId: string): boolean {
    return this.#sinks.has(deviceId);
  }

  /**
   * Deliver a message to a device. Returns `true` if sent live, `false` if the
   * device is offline and the message was buffered for later flush.
   */
  notify(deviceId: string, message: unknown): boolean {
    const sink = this.#sinks.get(deviceId);
    if (sink) {
      sink.send(message);
      return true;
    }
    let buffer = this.#buffers.get(deviceId);
    if (!buffer) {
      buffer = new OutboundMessageBuffer();
      this.#buffers.set(deviceId, buffer);
    }
    buffer.enqueue(message);
    return false;
  }
}
