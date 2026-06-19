/**
 * Tracks the live encrypted sink for each connected phone so the bridge can push
 * JSON-RPC notifications (e.g. streamed agent events) to it, and owns each
 * phone's persistent {@link OutboundLog} (seq counter + catch-up window).
 *
 * The log outlives any single connection: it is created on first use and kept
 * across reconnects (so a returning phone can be caught up via seq-based
 * replay), and is dropped only when the device is untrusted ({@link forget}).
 * Messages sent to a device with no active sink are recorded in its log (and
 * thus replayed on reconnect) instead of being lost.
 */
import { OutboundLog } from './outbound-log.js';

/** Encrypts a JSON-RPC message and writes it to the active connection. */
export interface SessionSink {
  send(message: unknown): void;
}

export class SessionRegistry {
  readonly #sinks = new Map<string, SessionSink>();
  readonly #logs = new Map<string, OutboundLog>();

  /**
   * The per-device outbound log, created on first use. The session handler
   * builds the secure channel over this so its `seq` continues across
   * reconnects and every outbound message is retained for catch-up.
   */
  logFor(deviceId: string): OutboundLog {
    let log = this.#logs.get(deviceId);
    if (!log) {
      log = new OutboundLog();
      this.#logs.set(deviceId, log);
    }
    return log;
  }

  /** Register the active sink for a device. */
  register(deviceId: string, sink: SessionSink): void {
    this.#sinks.set(deviceId, sink);
    // Ensure a log exists so subsequent broadcasts/notifies are retained even if
    // the handshake path didn't pre-create one.
    this.logFor(deviceId);
  }

  /**
   * Drop the live sink (e.g. on disconnect) but KEEP the outbound log so the
   * phone can be caught up when it reconnects.
   */
  unregister(deviceId: string): void {
    this.#sinks.delete(deviceId);
  }

  /**
   * Forget a device entirely — drop its sink AND its outbound log. Used when the
   * device is untrusted/unpaired: there is nothing to catch up anymore.
   */
  forget(deviceId: string): void {
    this.#sinks.delete(deviceId);
    this.#logs.delete(deviceId);
  }

  /**
   * Send a message to every known device: delivered live where a sink is
   * connected, recorded in the outbound log otherwise (so it replays on
   * reconnect). Each device keeps its own seq.
   */
  broadcast(message: unknown): void {
    for (const deviceId of this.#logs.keys()) {
      this.notify(deviceId, message);
    }
  }

  isActive(deviceId: string): boolean {
    return this.#sinks.has(deviceId);
  }

  /**
   * Deliver a message to a device. Returns `true` if sent live (the sink
   * encrypts it, which records it in the log), `false` if the device is offline
   * and the message was recorded in the log for later replay.
   */
  notify(deviceId: string, message: unknown): boolean {
    const sink = this.#sinks.get(deviceId);
    if (sink) {
      sink.send(message);
      return true;
    }
    // Offline: record the plaintext so a reconnecting phone replays it (seq > N).
    this.logFor(deviceId).record(Buffer.from(JSON.stringify(message), 'utf-8'));
    return false;
  }
}
