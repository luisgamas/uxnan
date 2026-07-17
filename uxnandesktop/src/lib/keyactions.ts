// Shared dispatcher for the app's keyboard actions, so the global handler
// (`+page.svelte`) and the terminal handler (`Terminal.svelte`) run identical
// code instead of two drifting switch blocks. Which actions win while a terminal
// is focused is decided separately by the arbiter (`keybindings.ts`); this only
// performs an action once someone decided to run it.

import { app } from "$lib/state/app.svelte";
import { terminals } from "$lib/state/terminals.svelte";
import { projects } from "$lib/state/projects.svelte";

export interface RunActionOpts {
  /** The terminal that had focus — so `closeCenter` closes *this* terminal
   *  rather than the active center tab. */
  terminalId?: string;
}

/** Run an app keyboard action by id. Returns `true` when it did something (so the
 *  caller should `preventDefault` / swallow the key), `false` when it was a no-op
 *  (let the key through). */
export function runAppAction(id: string, opts: RunActionOpts = {}): boolean {
  switch (id) {
    case "closeCenter":
      if (opts.terminalId) {
        void terminals.closeTabAnywhere(opts.terminalId);
        return true;
      }
      if (terminals.root) {
        terminals.closeActiveTab();
        return true;
      }
      return false;
    case "cycleTabNext":
      if (!terminals.root) return false;
      terminals.cycleTab(true);
      return true;
    case "cycleTabPrev":
      if (!terminals.root) return false;
      terminals.cycleTab(false);
      return true;
    case "focusSplitNext":
      if (!terminals.root) return false;
      terminals.focusSplit(1);
      return true;
    case "focusSplitPrev":
      if (!terminals.root) return false;
      terminals.focusSplit(-1);
      return true;
    case "newTerminal":
      app.openTerminal();
      return true;
    case "newGlobalTerminal":
      app.openGlobalTerminal();
      return true;
    case "splitRight":
      app.splitActiveTerminal("row");
      return true;
    case "splitDown":
      app.splitActiveTerminal("col");
      return true;
    case "worktreePalette":
      projects.paletteOpen = true;
      return true;
    case "addProject":
      projects.pickerOpen = true;
      return true;
    case "newWorktree":
      projects.requestNewWorktree(); // no-op outside a repo
      return true;
    case "openSettings":
      app.openSettings();
      return true;
    case "openGitHub":
      app.openGitHub();
      return true;
    case "openQuickCommands":
      app.quickCommandsMenuOpen = true;
      return true;
    case "toggleLeftSidebar":
      app.settings.leftSidebarOpen = !app.settings.leftSidebarOpen;
      void app.persistSettings();
      return true;
    case "toggleRightSidebar":
      app.settings.rightSidebarOpen = !app.settings.rightSidebarOpen;
      void app.persistSettings();
      return true;
    case "saveFile":
      return false; // handled by the editor's own CodeMirror keymap when focused
    default:
      return false;
  }
}
