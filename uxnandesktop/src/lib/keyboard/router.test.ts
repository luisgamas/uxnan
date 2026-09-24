import { describe, it, expect } from "vitest";

import { actionById } from "./actions";
import {
  defaultTerminalPolicy,
  routeKey,
  textOwnsChord,
  type RouteInput,
  type TerminalState,
} from "./router";

const term = (over: Partial<TerminalState> = {}): TerminalState => ({
  passthrough: false,
  leaderPending: false,
  ...over,
});

const route = (over: Partial<RouteInput>) =>
  routeKey({
    context: "app",
    chord: "Mod+J",
    action: null,
    policy: "terminal",
    handled: false,
    isLeader: false,
    mac: false,
    ...over,
  });

describe("routeKey — in a terminal", () => {
  const inTerm = (over: Partial<RouteInput>) => route({ context: "terminal", terminal: term(), ...over });

  it("the passthrough toggle always wins — even inside passthrough (so you can exit)", () => {
    expect(
      inTerm({ action: "toggleTerminalPassthrough", terminal: term({ passthrough: true }) }),
    ).toEqual({ kind: "passthrough" });
  });

  it("sends the key after the leader to Uxnan whatever the per-action policy", () => {
    expect(
      inTerm({ action: "worktreePalette", policy: "terminal", terminal: term({ leaderPending: true }) }),
    ).toEqual({ kind: "app", action: "worktreePalette" });
    expect(inTerm({ action: null, terminal: term({ leaderPending: true }) })).toEqual({
      kind: "surface",
      claim: false,
    });
  });

  it("in passthrough mode, everything else goes to the terminal", () => {
    expect(
      inTerm({ action: "newTerminal", policy: "app", terminal: term({ passthrough: true }) }),
    ).toEqual({ kind: "surface", claim: false });
  });

  it("the leader chord arms the leader", () => {
    expect(inTerm({ isLeader: true })).toEqual({ kind: "leader" });
  });

  it("follows the action's policy", () => {
    expect(inTerm({ action: "newTerminal", policy: "app" })).toEqual({ kind: "app", action: "newTerminal" });
    expect(inTerm({ action: "closeCenter", policy: "terminal" })).toEqual({ kind: "surface", claim: false });
    expect(inTerm({ action: null })).toEqual({ kind: "surface", claim: false });
  });

  it("claims a ⌘ shortcut it leaves to the terminal on macOS, so the menu bar cannot run it", () => {
    expect(
      inTerm({ mac: true, chord: "Mod+B", action: "toggleLeftSidebar", policy: "terminal" }),
    ).toEqual({ kind: "surface", claim: true });
    expect(
      inTerm({ mac: true, chord: "Mod+B", action: "toggleLeftSidebar", terminal: term({ passthrough: true }) }),
    ).toEqual({ kind: "surface", claim: true });
    // A Control chord is the shell's: nothing to claim.
    expect(inTerm({ mac: true, chord: "Ctrl+B", action: "toggleLeftSidebar" })).toEqual({
      kind: "surface",
      claim: false,
    });
  });
});

describe("routeKey — outside a terminal", () => {
  it("runs a bound action", () => {
    expect(route({ action: "toggleRightSidebar" })).toEqual({ kind: "app", action: "toggleRightSidebar" });
    expect(route({ action: null })).toEqual({ kind: "surface", claim: false });
  });

  it("leaves a key a focused widget already handled", () => {
    // The editor's own keymap redid (⌘⇧Z) — the app must not also act on it.
    expect(route({ context: "editor", chord: "Mod+Shift+Z", action: "x", handled: true })).toEqual({
      kind: "surface",
      claim: false,
    });
  });

  it("leaves a text field its editing chords", () => {
    expect(route({ context: "text", chord: "Mod+Shift+Z", action: "x" })).toEqual({
      kind: "surface",
      claim: false,
    });
    expect(route({ context: "text", chord: "Mod+Shift+ArrowRight", action: "splitRight" })).toEqual({
      kind: "surface",
      claim: false,
    });
    // …but not the app's own chords.
    expect(route({ context: "text", chord: "Mod+W", action: "closeCenter" })).toEqual({
      kind: "app",
      action: "closeCenter",
    });
  });

  it("does not protect editing chords outside a text field", () => {
    expect(route({ context: "app", chord: "Mod+Shift+ArrowRight", action: "splitRight" })).toEqual({
      kind: "app",
      action: "splitRight",
    });
  });
});

describe("textOwnsChord", () => {
  it("keeps typing, including Option and Shift characters", () => {
    expect(textOwnsChord("A", false)).toBe(true);
    expect(textOwnsChord("Shift+A", true)).toBe(true);
    expect(textOwnsChord("Alt+S", true)).toBe(true);
    expect(textOwnsChord("Space", false)).toBe(true);
  });

  it("keeps caret movement, selection and deletion with any modifier", () => {
    for (const chord of ["Mod+Shift+ArrowRight", "Alt+ArrowLeft", "Mod+Backspace", "Shift+End", "Mod+Home"]) {
      expect(textOwnsChord(chord, true)).toBe(true);
      expect(textOwnsChord(chord, false)).toBe(true);
    }
  });

  it("keeps undo, redo, select all and the clipboard", () => {
    for (const chord of ["Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+A", "Mod+C", "Mod+X", "Mod+V"]) {
      expect(textOwnsChord(chord, true)).toBe(true);
    }
  });

  it("keeps macOS's Control-letter editing keys", () => {
    expect(textOwnsChord("Ctrl+A", true)).toBe(true);
    expect(textOwnsChord("Ctrl+K", true)).toBe(true);
    // ⌃Tab is not one.
    expect(textOwnsChord("Ctrl+Tab", true)).toBe(false);
  });

  it("keeps the characters AltGr types off macOS", () => {
    expect(textOwnsChord("Mod+Alt+Q", false)).toBe(true);
    expect(textOwnsChord("Mod+Alt+Q", true)).toBe(false);
  });

  it("leaves the app its shortcuts", () => {
    for (const chord of ["Mod+W", "Mod+J", "Mod+Shift+P", "Mod+,", "Ctrl+Tab", "Escape", "F5"]) {
      expect(textOwnsChord(chord, true)).toBe(false);
      expect(textOwnsChord(chord, false)).toBe(false);
    }
  });
});

describe("defaultTerminalPolicy", () => {
  it("lets a ⌘ shortcut win on macOS — ⌘ never reaches a shell", () => {
    expect(defaultTerminalPolicy("terminal", "Mod+W", true)).toBe("app");
    expect(defaultTerminalPolicy("terminal", "Mod+K", true)).toBe("app");
  });

  it("keeps the registry's choice off macOS and for Control chords", () => {
    expect(defaultTerminalPolicy("terminal", "Mod+W", false)).toBe("terminal");
    expect(defaultTerminalPolicy("terminal", "Ctrl+W", true)).toBe("terminal");
    expect(defaultTerminalPolicy("app", "Ctrl+Tab", true)).toBe("app");
  });

  it("yields the shell's own chords off macOS", () => {
    // Ctrl+W delete-word, Ctrl+S XOFF, Ctrl+P history, Ctrl+B tmux, Ctrl+J
    // newline, Ctrl+K kill-line.
    for (const id of ["closeCenter", "saveFile", "worktreePalette", "toggleLeftSidebar", "toggleRightSidebar", "clearTerminal"]) {
      expect(actionById(id)?.terminal).toBe("terminal");
    }
    for (const id of ["openQuickCommands", "newTerminal", "cycleTabNext", "toggleTerminalPassthrough"]) {
      expect(actionById(id)?.terminal).toBe("app");
    }
  });
});
