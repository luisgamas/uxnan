import { describe, it, expect } from "vitest";
import {
  decideTerminalKey,
  defaultTerminalPolicy,
  DEFAULT_TERMINAL_POLICY,
  type ArbiterContext,
} from "./terminalArbiter";

const ctx = (over: Partial<ArbiterContext> = {}): ArbiterContext => ({
  passthrough: false,
  leaderPending: false,
  ...over,
});

describe("decideTerminalKey", () => {
  it("the passthrough toggle always wins — even inside passthrough (so you can exit)", () => {
    expect(
      decideTerminalKey({
        action: "toggleTerminalPassthrough",
        isLeader: false,
        actionWins: false,
        ctx: ctx({ passthrough: true }),
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("routes the key after the leader to uxnan whatever the per-action policy", () => {
    expect(
      decideTerminalKey({
        action: "worktreePalette", // normally yields to the TUI
        isLeader: false,
        actionWins: false,
        ctx: ctx({ leaderPending: true }),
      }),
    ).toEqual({ kind: "app", action: "worktreePalette" });
  });

  it("a non-action key after the leader falls through to the terminal", () => {
    expect(
      decideTerminalKey({ action: null, isLeader: false, actionWins: false, ctx: ctx({ leaderPending: true }) }),
    ).toEqual({ kind: "terminal" });
  });

  it("in passthrough mode, everything else goes to the terminal", () => {
    expect(
      decideTerminalKey({ action: "newTerminal", isLeader: false, actionWins: true, ctx: ctx({ passthrough: true }) }),
    ).toEqual({ kind: "terminal" });
  });

  it("the leader chord arms the leader", () => {
    expect(decideTerminalKey({ action: null, isLeader: true, actionWins: false, ctx: ctx() })).toEqual({
      kind: "leader",
    });
  });

  it("an app-policy action wins in the terminal", () => {
    expect(decideTerminalKey({ action: "newTerminal", isLeader: false, actionWins: true, ctx: ctx() })).toEqual({
      kind: "app",
      action: "newTerminal",
    });
  });

  it("a terminal-policy action yields to the TUI/agent", () => {
    expect(decideTerminalKey({ action: "closeCenter", isLeader: false, actionWins: false, ctx: ctx() })).toEqual({
      kind: "terminal",
    });
  });

  it("an unmatched key goes to the terminal", () => {
    expect(decideTerminalKey({ action: null, isLeader: false, actionWins: false, ctx: ctx() })).toEqual({
      kind: "terminal",
    });
  });
});

describe("DEFAULT_TERMINAL_POLICY", () => {
  it("yields the shell/TUI-critical chords to the terminal", () => {
    expect(DEFAULT_TERMINAL_POLICY.closeCenter).toBe("terminal"); // Ctrl+W delete-word
    expect(DEFAULT_TERMINAL_POLICY.saveFile).toBe("terminal"); // Ctrl+S XOFF
    expect(DEFAULT_TERMINAL_POLICY.worktreePalette).toBe("terminal"); // Ctrl+P history
    expect(DEFAULT_TERMINAL_POLICY.toggleLeftSidebar).toBe("terminal"); // Ctrl+B tmux
    expect(DEFAULT_TERMINAL_POLICY.toggleRightSidebar).toBe("terminal"); // Ctrl+J newline
  });

  it("reserves the low-collision app shortcuts", () => {
    expect(DEFAULT_TERMINAL_POLICY.openQuickCommands).toBe("app");
    expect(DEFAULT_TERMINAL_POLICY.newTerminal).toBe("app");
    expect(DEFAULT_TERMINAL_POLICY.cycleTabNext).toBe("app");
    expect(DEFAULT_TERMINAL_POLICY.toggleTerminalPassthrough).toBe("app");
  });
});

describe("defaultTerminalPolicy", () => {
  it("lets a ⌘ shortcut win on macOS — ⌘ never reaches a shell", () => {
    // closeCenter yields Ctrl+W to the shell elsewhere; on a Mac it is ⌘W.
    expect(defaultTerminalPolicy("closeCenter", "Mod+W", true)).toBe("app");
    expect(defaultTerminalPolicy("toggleLeftSidebar", "Mod+B", true)).toBe("app");
    expect(defaultTerminalPolicy("saveFile", "Mod+S", true)).toBe("app");
  });

  it("keeps yielding Ctrl chords to the terminal off macOS", () => {
    expect(defaultTerminalPolicy("closeCenter", "Mod+W", false)).toBe("terminal");
    expect(defaultTerminalPolicy("toggleLeftSidebar", "Mod+B", false)).toBe("terminal");
  });

  it("keeps the table for a literal Ctrl chord on macOS", () => {
    // Rebound to Ctrl on a Mac, it is a shell's chord again.
    expect(defaultTerminalPolicy("closeCenter", "Ctrl+W", true)).toBe("terminal");
    expect(defaultTerminalPolicy("splitRight", "Ctrl+D", true)).toBe("app");
  });
});
