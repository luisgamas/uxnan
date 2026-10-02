/**
 * A terminal the backend already had is not launched into again.
 *
 * `pty_create` answers `false` when the terminal existed before the call: a
 * webview reload over a live PTY, or — on a host — a tab that found its
 * terminal again in that host's daemon after the app restarted. Whatever the
 * tab was opened to run is already running there, so typing its launch line
 * would drop the command into the middle of the agent it started.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeBackend, type FakeBackend } from "../../test/tauri";
// The store first, as the app loads it: it and the instance registry import
// each other, and entering the cycle from this side leaves its handler unset.
import "$lib/state/terminals.svelte";
import { spawnPty, type TerminalInstance } from "./instances";

function instance(id: string): TerminalInstance {
  return {
    id,
    spec: { runCommand: "claude", runCommandExecute: true, target: "ssh:h1", sid: "s1" },
    desiredCols: 0,
    desiredRows: 0,
    lastCols: 0,
    lastRows: 0,
    launched: false,
    spawnFailed: false,
    sawOutput: false,
  } as unknown as TerminalInstance;
}

let backend: FakeBackend;
let fresh: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  fresh = true;
  backend = installFakeBackend({
    pty_create: () => fresh,
    pty_resize: () => null,
    pty_write: () => null,
    mcp_launch_catalog: () => [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("spawnPty — the one-shot launch", () => {
  it("sends the tab's persistent session id with the spawn", async () => {
    await spawnPty(instance("t0"), 80, 24);
    expect(backend.lastCallTo("pty_create")?.args.sid).toBe("s1");
  });

  it("types the launch into a terminal that was just opened", async () => {
    await spawnPty(instance("t1"), 80, 24);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.callsTo("pty_write")).toHaveLength(1);
  });

  it("types nothing into a terminal that was found again", async () => {
    fresh = false;
    const inst = instance("t2");
    await spawnPty(inst, 80, 24);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.callsTo("pty_write")).toHaveLength(0);
    expect(inst.launched).toBe(true);
  });
});
