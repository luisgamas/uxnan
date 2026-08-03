import { describe, expect, it, vi } from "vitest";
import {
  describeError,
  formatErrorEvent,
  installErrorReporter,
} from "./errorReporter";

describe("describeError", () => {
  it("keeps an Error's stack, which is what makes a blank-screen report actionable", () => {
    const error = new TypeError("x is not a function");
    error.stack = "TypeError: x is not a function\n    at render (chunk.js:1:2)";
    expect(describeError(error)).toContain("at render (chunk.js:1:2)");
  });

  it("does not repeat the name and message when the stack already carries them", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at a (b.js:1:1)";
    expect(describeError(error)).toBe("Error: boom\n    at a (b.js:1:1)");
  });

  it("survives a thrown non-Error", () => {
    // `throw` accepts anything, and a report that crashes on a thrown string
    // would lose the very failure it exists to record.
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError(undefined)).toBe("undefined");
    expect(describeError(null)).toBe("null");
    expect(describeError({ code: 42 })).toBe('{"code":42}');
  });

  it("survives a value that cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe("[object Object]");
  });

  it("bounds a runaway stack before it crosses the IPC boundary", () => {
    const error = new Error("big");
    error.stack = `Error: big\n${"    at frame\n".repeat(2000)}`;
    expect(describeError(error).length).toBeLessThanOrEqual(4000);
  });
});

describe("formatErrorEvent", () => {
  it("appends the source location the browser reported", () => {
    const line = formatErrorEvent({
      message: "boom",
      filename: "chunk.js",
      lineno: 1,
      colno: 12345,
    });
    expect(line).toBe("boom (chunk.js:1:12345)");
  });

  it("prefers the real error object over the event's message string", () => {
    const error = new Error("the real cause");
    error.stack = "Error: the real cause\n    at x (y.js:3:4)";
    const line = formatErrorEvent({ message: "Script error.", error });
    expect(line).toContain("the real cause");
    expect(line).not.toContain("Script error.");
  });

  it("falls back to a description when there is nothing at all", () => {
    expect(formatErrorEvent({})).toBe("uncaught error");
  });
});

describe("installErrorReporter", () => {
  function fakeWindow() {
    const listeners = new Map<string, EventListener>();
    return {
      listeners,
      addEventListener: (type: string, fn: EventListener) =>
        listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as Window & { listeners: Map<string, EventListener> };
  }

  it("reports an uncaught error", () => {
    const win = fakeWindow();
    const report = vi.fn();
    installErrorReporter(win, report);

    (win as unknown as { listeners: Map<string, EventListener> }).listeners
      .get("error")?.({
      message: "boom",
      filename: "chunk.js",
      lineno: 2,
      colno: 3,
    } as unknown as Event);

    expect(report).toHaveBeenCalledWith(
      "error",
      "webview.error",
      "boom (chunk.js:2:3)",
    );
  });

  it("reports an unhandled rejection", () => {
    const win = fakeWindow();
    const report = vi.fn();
    installErrorReporter(win, report);

    (win as unknown as { listeners: Map<string, EventListener> }).listeners
      .get("unhandledrejection")?.({
      reason: "database is locked",
    } as unknown as Event);

    expect(report).toHaveBeenCalledWith(
      "error",
      "webview.rejection",
      "database is locked",
    );
  });

  it("never lets a failing report become a second failure", () => {
    const win = fakeWindow();
    const throwing = vi.fn(() => {
      throw new Error("IPC is gone");
    });
    installErrorReporter(win, throwing);

    expect(() =>
      (win as unknown as { listeners: Map<string, EventListener> }).listeners
        .get("error")?.({ message: "boom" } as unknown as Event),
    ).not.toThrow();
  });

  it("swallows a rejected report", async () => {
    const win = fakeWindow();
    const rejecting = vi.fn(() => Promise.reject(new Error("backend down")));
    installErrorReporter(win, rejecting);

    (win as unknown as { listeners: Map<string, EventListener> }).listeners
      .get("error")?.({ message: "boom" } as unknown as Event);
    // An unhandled rejection here would itself trip the reporter in production.
    await expect(Promise.resolve()).resolves.toBeUndefined();
  });

  it("uninstalls both listeners", () => {
    const win = fakeWindow();
    const uninstall = installErrorReporter(win, vi.fn());
    uninstall();
    const listeners = (win as unknown as { listeners: Map<string, EventListener> })
      .listeners;
    expect(listeners.size).toBe(0);
  });
});
