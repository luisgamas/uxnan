/**
 * Follows the machine's reachable addresses as it changes networks — a laptop
 * moved from home to the office, a Wi-Fi that handed out a new lease, Tailscale
 * coming up. The bridge used to learn them once at start, so a phone paired on
 * one network kept dialling that network's address everywhere else and fell
 * back to the relay right next to its PC.
 *
 * Polling `networkInterfaces()` is a few microseconds and needs no native
 * dependency; every {@link NETWORK_POLL_MS} is enough for a person carrying a
 * laptop between rooms. The timer is unref'd and stops with the bridge.
 */
import { localIPv4s, type InterfaceMap } from './local-hosts.js';

export const NETWORK_POLL_MS = 15_000;

export interface NetworkWatcherOptions {
  /** Called with the new address set (sorted) whenever it differs from the last. */
  onChange(addresses: string[]): void;
  /** Override the interface source (tests). */
  interfaces?: () => InterfaceMap;
  pollMs?: number;
}

export class NetworkWatcher {
  readonly #options: NetworkWatcherOptions;
  #current: string[];
  #timer: NodeJS.Timeout | undefined;

  constructor(options: NetworkWatcherOptions) {
    this.#options = options;
    this.#current = this.#read();
  }

  /** The addresses as last seen. */
  get addresses(): string[] {
    return [...this.#current];
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.check(), this.#options.pollMs ?? NETWORK_POLL_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Re-read the interfaces now; reports a change. Returns whether one happened. */
  check(): boolean {
    const next = this.#read();
    if (sameList(next, this.#current)) return false;
    this.#current = next;
    this.#options.onChange([...next]);
    return true;
  }

  #read(): string[] {
    return this.#options.interfaces ? localIPv4s(this.#options.interfaces()) : localIPv4s();
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
