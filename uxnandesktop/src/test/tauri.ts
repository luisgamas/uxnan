/**
 * A fake Tauri backend for component tests.
 *
 * The obvious way to test a component that calls `api.getAppState()` is to mock
 * `$lib/api`. That is also the way to end up with a test suite that passes
 * against a contract the app no longer has: the mock and `api.ts` drift, and
 * nothing notices, because the mock *is* the assertion.
 *
 * So the seam is one layer lower. Tauri ships `mockIPC`, which replaces the IPC
 * transport itself (`window.__TAURI_INTERNALS__.invoke`). `src/lib/api.ts` runs
 * **for real** — its command names, its argument marshalling, its return types —
 * and only the process on the other side is fake. A renamed command or a changed
 * argument shape shows up as a failing test rather than as a mock nobody
 * updated.
 *
 * What this module adds on top:
 *
 * - **a typed handler table** keyed by command name, with an unhandled command
 *   rejecting loudly instead of returning `undefined` (which would surface much
 *   later as a confusing null-deref inside the component);
 * - **a call log**, so a test can assert *what* the component asked the backend
 *   for, not just what it rendered;
 * - **event emission**, because half the app's behaviour arrives through
 *   `listen()` rather than through a command's return value;
 * - **failure and latency injection**, since "the backend said no" and "the
 *   backend was slow" are states real users hit and components rarely handle.
 */

import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

/** A command handler. May be sync or async; throwing rejects the `invoke`. */
export type CommandHandler = (args: Record<string, unknown>) => unknown;

/** Command name → handler. Keys are the real Rust command names. */
export type CommandTable = Record<string, CommandHandler>;

/** One recorded call, in order. */
export interface RecordedCall {
  command: string;
  args: Record<string, unknown>;
}

export interface FakeBackend {
  /** Every `invoke` the app made, oldest first. */
  readonly calls: RecordedCall[];
  /** Calls for one command, in order. */
  callsTo(command: string): RecordedCall[];
  /** The most recent call to a command, or `undefined`. */
  lastCallTo(command: string): RecordedCall | undefined;
  /** Whether the app ever issued this command. */
  called(command: string): boolean;
  /** Add or replace handlers after `installFakeBackend` (e.g. to make a command
   *  start failing halfway through a test). */
  setCommands(commands: CommandTable): void;
  /** Deliver a Tauri event to everything currently listening for it. */
  emit(event: string, payload: unknown): void;
  /** How many listeners are registered for an event — the cheap way to assert a
   *  component unsubscribed on unmount. */
  listenerCount(event: string): number;
  /** Forget recorded calls, keeping handlers and listeners. */
  clearCalls(): void;
}

/** Commands every mounted component tends to reach for. Individual tests
 *  override what they care about; without these, mounting almost anything fails
 *  on an unrelated command. */
function baseCommands(): CommandTable {
  return {
    ping: () => true,
    // Tauri's own plugin channels the app touches indirectly.
    "plugin:event|listen": () => 0,
    "plugin:event|unlisten": () => undefined,
    "plugin:event|emit": () => undefined,
    "plugin:window|theme": () => "light",
  };
}

/**
 * Install the fake backend for the current test. Returns the handle used to
 * inspect and steer it.
 *
 * Call `uninstallFakeBackend()` afterwards — `setup.dom.ts` does it globally in
 * `afterEach`, so a test only needs to do it explicitly when it installs a
 * second backend mid-test.
 */
export function installFakeBackend(commands: CommandTable = {}): FakeBackend {
  const calls: RecordedCall[] = [];
  let table: CommandTable = { ...baseCommands(), ...commands };
  /** event name → listener handlers, keyed by the id we handed Tauri. */
  const listeners = new Map<string, Map<number, (event: unknown) => void>>();
  let nextListenerId = 1;

  mockWindows("main");

  mockIPC(async (cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;

    // Event subscription rides the same channel as any other command. Tauri
    // hands us the callback as a "channel" object whose id we call back through.
    if (cmd === "plugin:event|listen") {
      const event = String(args.event ?? "");
      const handler = args.handler as { onmessage?: (e: unknown) => void } | undefined;
      const id = nextListenerId++;
      if (!listeners.has(event)) listeners.set(event, new Map());
      listeners.get(event)!.set(id, (e) => handler?.onmessage?.(e));
      calls.push({ command: cmd, args });
      return id;
    }
    if (cmd === "plugin:event|unlisten") {
      const event = String(args.event ?? "");
      listeners.get(event)?.delete(Number(args.eventId));
      calls.push({ command: cmd, args });
      return undefined;
    }

    calls.push({ command: cmd, args });
    const handler = table[cmd];
    if (!handler) {
      // Loud on purpose: an unhandled command returning `undefined` would fail
      // somewhere else entirely, and the test would blame the wrong code.
      throw new Error(
        `fake backend: no handler for "${cmd}". Add it to installFakeBackend({ "${cmd}": () => … }).`,
      );
    }
    return await handler(args);
  });

  return {
    calls,
    callsTo: (command) => calls.filter((c) => c.command === command),
    lastCallTo: (command) => [...calls].reverse().find((c) => c.command === command),
    called: (command) => calls.some((c) => c.command === command),
    setCommands: (next) => {
      table = { ...table, ...next };
    },
    emit: (event, payload) => {
      const target = listeners.get(event);
      if (!target) return;
      for (const deliver of [...target.values()]) {
        deliver({ event, id: 0, payload });
      }
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
    clearCalls: () => {
      calls.length = 0;
    },
  };
}

/** Tear the fake backend down. Idempotent. */
export function uninstallFakeBackend(): void {
  clearMocks();
}

// --- handler helpers --------------------------------------------------------

/** A handler that rejects, for testing how a component reports backend errors.
 *  Shaped like the real `CommandError` the Rust side returns. */
export function failsWith(code: string, message: string): CommandHandler {
  return () => {
    throw { code, message };
  };
}

/**
 * A handler that resolves only when the test says so — for asserting the state
 * a component shows *while* it waits, which is the part that usually has no
 * test and usually has the bug.
 */
export function deferred<T>(): { handler: CommandHandler; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { handler: () => promise, resolve, reject };
}
