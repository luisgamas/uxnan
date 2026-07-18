import { describe, it, expect, vi, afterEach } from "vitest";
import { isOrphanedPointerLock, deferModalOpen } from "./pointerLock";

describe("isOrphanedPointerLock", () => {
  it("is orphaned when the body is locked with no open modal layer", () => {
    expect(isOrphanedPointerLock("none", false)).toBe(true);
  });

  it("is NOT orphaned while a modal layer is open (legit lock)", () => {
    expect(isOrphanedPointerLock("none", true)).toBe(false);
  });

  it("is NOT orphaned when the body carries no inline lock", () => {
    expect(isOrphanedPointerLock("", false)).toBe(false);
    expect(isOrphanedPointerLock("auto", false)).toBe(false);
    expect(isOrphanedPointerLock("", true)).toBe(false);
  });
});

describe("deferModalOpen", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the modal on a later macrotask, never synchronously", () => {
    vi.useFakeTimers();
    const open = vi.fn();
    deferModalOpen(open);
    expect(open).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("no-ops on a nullish handler", () => {
    vi.useFakeTimers();
    expect(() => deferModalOpen(undefined)).not.toThrow();
    expect(() => deferModalOpen(null)).not.toThrow();
    vi.runAllTimers();
  });
});

// `installPointerLockGuard` is DOM-driven (window/document, capture-phase
// `pointerdown`); the Vitest harness runs in the node environment (see
// vitest.config.ts), so it has no `document` to exercise. Its logic is the pure
// `isOrphanedPointerLock` predicate covered above plus the 120 ms re-check; the
// end-to-end freeze/recovery behavior is verified by manual DevTools QA. Add
// jsdom + an installer test here if the harness gains a DOM env.
