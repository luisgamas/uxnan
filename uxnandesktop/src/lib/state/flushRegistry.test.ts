import { afterEach, describe, expect, it, vi } from "vitest";
import { flushAll, registerFlush, unregisterFlush } from "./flushRegistry";

// The registry is a module-level singleton, so every id a test adds is cleaned up
// afterwards to keep the tests isolated (a leaked flush would run in a later
// `flushAll` and skew the call counts).
const ids = new Set<string>();
function add(id: string, fn: () => void | Promise<void>) {
  ids.add(id);
  registerFlush(id, fn);
}
afterEach(() => {
  for (const id of ids) unregisterFlush(id);
  ids.clear();
});

describe("flushRegistry", () => {
  it("runs every registered flush on flushAll", async () => {
    const a = vi.fn();
    const b = vi.fn();
    add("a", a);
    add("b", b);
    await flushAll();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("runs all flushes even when one rejects (allSettled semantics)", async () => {
    const ok = vi.fn();
    const bad = vi.fn(() => Promise.reject(new Error("boom")));
    add("ok", ok);
    add("bad", bad);
    // A failing flush never blocks the others and never rejects flushAll.
    await expect(flushAll()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("unregisterFlush removes a flush", async () => {
    const fn = vi.fn();
    add("gone", fn);
    unregisterFlush("gone");
    ids.delete("gone");
    await flushAll();
    expect(fn).not.toHaveBeenCalled();
  });

  it("re-registering the same id replaces the previous flush", async () => {
    const first = vi.fn();
    const second = vi.fn();
    add("dup", first);
    add("dup", second); // same id → replaces the first
    await flushAll();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("flushAll on an empty registry resolves without error", async () => {
    await expect(flushAll()).resolves.toBeUndefined();
  });
});
