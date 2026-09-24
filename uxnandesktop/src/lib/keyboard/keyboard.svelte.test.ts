import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "$lib/state/app.svelte";
import {
  actionForChord,
  handleWindowKey,
  nativeCommands,
  resolveBinding,
  resolveTerminalPolicy,
  routeTerminalKey,
} from "./keyboard.svelte";

// jsdom is not a Mac: `Mod` is Ctrl here.

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, "target", { value: target });
  return e;
}

describe("the person's bindings", () => {
  beforeEach(() => {
    app.settings.keybindings = {};
    app.settings.terminalKeyPolicy = {};
  });

  it("uses each platform's default", () => {
    expect(resolveBinding("cycleTabNext")).toBe("Mod+Tab"); // Ctrl+Tab
    expect(resolveBinding("focusSplitNext")).toBe("Alt+ArrowRight");
    expect(resolveBinding("toggleRightSidebar")).toBe("Mod+J");
  });

  it("leaves sleeping a workspace unbound — it used to be Redo's chord", () => {
    expect(resolveBinding("sleepWorkspace")).toBe("");
    expect(actionForChord("Mod+Shift+Z")).toBeNull();
  });

  it("applies an override, in canonical form", () => {
    app.settings.keybindings = { toggleRightSidebar: "Shift+Ctrl+j" };
    expect(resolveBinding("toggleRightSidebar")).toBe("Mod+Shift+J");
    expect(actionForChord("Mod+Shift+J")).toBe("toggleRightSidebar");
  });

  it("yields the shell's chords in a terminal unless the person chose", () => {
    expect(resolveTerminalPolicy("closeCenter")).toBe("terminal");
    app.settings.terminalKeyPolicy = { closeCenter: "app" };
    expect(resolveTerminalPolicy("closeCenter")).toBe("app");
  });

  it("gives the native layer the global commands only", () => {
    const ids = nativeCommands().map((c) => c.id);
    expect(ids).toContain("toggleRightSidebar");
    expect(ids).toContain("openSettings");
    expect(ids).not.toContain("closeCenter");
    expect(ids).not.toContain("saveFile");
  });
});

describe("the window's keys", () => {
  let persist: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    persist = vi.spyOn(app, "persistSettings").mockResolvedValue();
    app.settings.keybindings = { toggleLeftSidebar: "Mod+Shift+Z" };
    app.settings.leftSidebarOpen = true;
  });

  afterEach(() => {
    persist.mockRestore();
    app.settings.keybindings = {};
  });

  it("runs a bound action from the app's surface", () => {
    const e = press(document.createElement("div"), { key: "z", ctrlKey: true, shiftKey: true });
    handleWindowKey(e);
    expect(app.settings.leftSidebarOpen).toBe(false);
    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves a text field its redo", () => {
    const e = press(document.createElement("textarea"), { key: "z", ctrlKey: true, shiftKey: true });
    handleWindowKey(e);
    expect(app.settings.leftSidebarOpen).toBe(true);
    expect(e.defaultPrevented).toBe(false);
  });

  it("leaves a key the editor already handled", () => {
    const e = press(document.createElement("div"), { key: "z", ctrlKey: true, shiftKey: true });
    e.preventDefault();
    handleWindowKey(e);
    expect(app.settings.leftSidebarOpen).toBe(true);
  });

  it("leaves a terminal's keys to its own hook", () => {
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const inner = document.createElement("textarea");
    xterm.append(inner);
    handleWindowKey(press(inner, { key: "z", ctrlKey: true, shiftKey: true }));
    expect(app.settings.leftSidebarOpen).toBe(true);
  });
});

describe("a terminal's keys", () => {
  beforeEach(() => {
    app.settings.keybindings = {};
    app.settings.terminalKeyPolicy = {};
    app.settings.leaderKey = "";
  });

  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("gives the shell its Ctrl chords and the app its reserved ones", () => {
    expect(routeTerminalKey(key({ key: "w", ctrlKey: true }), { passthrough: false, leaderPending: false })).toEqual({
      kind: "surface",
      claim: false,
    });
    expect(
      routeTerminalKey(key({ key: "p", ctrlKey: true, shiftKey: true }), { passthrough: false, leaderPending: false }),
    ).toEqual({ kind: "app", action: "openQuickCommands" });
  });

  it("sends the shortcut after the leader to Uxnan", () => {
    app.settings.leaderKey = "Mod+A";
    expect(routeTerminalKey(key({ key: "a", ctrlKey: true }), { passthrough: false, leaderPending: false })).toEqual({
      kind: "leader",
    });
    expect(routeTerminalKey(key({ key: "w", ctrlKey: true }), { passthrough: false, leaderPending: true })).toEqual({
      kind: "app",
      action: "closeCenter",
    });
  });
});
