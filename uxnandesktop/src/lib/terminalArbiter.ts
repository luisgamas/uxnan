// Pure terminal-keyboard arbitration — decide whether a keydown in a focused
// terminal is an app shortcut, goes to the TUI/agent, toggles focus mode, or
// arms the leader. No DOM or store access, so it's unit-testable in isolation.
// The app-state wrappers (reading the user's overrides / leader chord) live in
// `keybindings.ts`.

/** Which side wins a chord while a terminal is focused. */
export type TerminalPolicy = "app" | "terminal";

/** Default per-action behaviour while a terminal is focused: `app` = the uxnan
 *  shortcut wins (reserved set), `terminal` = the key is sent to the TUI/agent.
 *  Reserves the low-collision Mod+Shift / Mod+Alt chords and yields the ones
 *  shells & TUIs rely on — Ctrl+W (delete-word), Ctrl+P (history), Ctrl+S (XOFF),
 *  Ctrl+J (newline), Ctrl+B (tmux prefix). Every action is user-overridable
 *  (Settings → Keyboard shortcuts), and a leader key can force any single key to
 *  uxnan on demand. */
export const DEFAULT_TERMINAL_POLICY: Record<string, TerminalPolicy> = {
  openSettings: "app",
  openQuickCommands: "app",
  worktreePalette: "terminal",
  addProject: "terminal",
  newWorktree: "app",
  toggleLeftSidebar: "terminal",
  toggleRightSidebar: "terminal",
  newTerminal: "app",
  newGlobalTerminal: "app",
  splitRight: "app",
  splitDown: "app",
  cycleTabNext: "app",
  cycleTabPrev: "app",
  focusSplitNext: "app",
  focusSplitPrev: "app",
  closeCenter: "terminal",
  saveFile: "terminal",
  toggleTerminalPassthrough: "app",
};

/** What should happen to a keydown while a terminal is focused. */
export type KeyDisposition =
  | { kind: "app"; action: string } // uxnan runs it; swallow the key
  | { kind: "terminal" } // send it to the TUI/agent
  | { kind: "passthrough" } // toggle this terminal's focus (passthrough) mode
  | { kind: "leader" }; // arm the leader (swallow it; next key overrides to uxnan)

/** Transient terminal-keyboard state the arbiter needs. */
export interface ArbiterContext {
  /** This terminal is in focus/passthrough mode (everything goes to the TUI). */
  passthrough: boolean;
  /** The previous keydown in this terminal was the leader chord. */
  leaderPending: boolean;
}

/** Pure arbitration decision. Order matters: the passthrough toggle always wins
 *  (so you can always exit focus mode); a pending leader overrides the per-action
 *  policy for one key; passthrough sends the rest to the terminal; otherwise the
 *  leader arms, or the per-action policy decides. */
export function decideTerminalKey(input: {
  /** The uxnan action this chord maps to, or null. */
  action: string | null;
  /** This chord is the leader chord. */
  isLeader: boolean;
  /** The matched action's terminal policy is `app` (wins in terminal). */
  actionWins: boolean;
  ctx: ArbiterContext;
}): KeyDisposition {
  const { action, isLeader, actionWins, ctx } = input;
  if (action === "toggleTerminalPassthrough") return { kind: "passthrough" };
  if (ctx.leaderPending) {
    return action ? { kind: "app", action } : { kind: "terminal" };
  }
  if (ctx.passthrough) return { kind: "terminal" };
  if (isLeader) return { kind: "leader" };
  if (action && actionWins) return { kind: "app", action };
  return { kind: "terminal" };
}
