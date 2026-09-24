// Runs the app's keyboard actions — one place, whoever heard the key: the
// window (`+page.svelte`), a terminal (`Terminal.svelte`) or the native layer
// for a browser page (`keyboard:action`). Who gets a key is decided by the
// router (`router.ts`); this only performs an action once it was decided.

import { app } from "$lib/state/app.svelte";
import { terminals } from "$lib/state/terminals.svelte";
import { projects } from "$lib/state/projects.svelte";
import { dock } from "$lib/state/dock.svelte";
import { toast } from "$lib/toast";
import { i18n } from "$lib/i18n";

export interface RunActionOpts {
  /** The terminal that had focus — so `closeCenter` closes *this* terminal
   *  rather than the active center tab, and `clearTerminal` has one to clear. */
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
    case "clearTerminal": {
      const controller = opts.terminalId ? terminals.controller(opts.terminalId) : undefined;
      if (!controller) return false;
      controller.clear();
      return true;
    }
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
    case "sleepWorkspace": {
      // Sleep the active workspace. With a working agent inside, the shortcut
      // declines (killing a mid-turn agent needs the row menu's explicit
      // confirm) and says so.
      const key = terminals.activeWorkspace;
      if (!key || terminals.terminalCount(key) === 0 || terminals.isWorkspaceAsleep(key)) {
        return false;
      }
      if (terminals.sleepBlockers(key).length > 0) {
        toast.warning(i18n.t("workspace.sleepBlockedToast"));
        return true;
      }
      void terminals.sleepWorkspace(key);
      return true;
    }
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
    case "openAutomations":
      app.openAutomations();
      return true;
    case "openQuickCommands":
      app.quickCommandsMenuOpen = true;
      return true;
    case "toggleLeftSidebar":
      app.settings.leftSidebarOpen = !app.settings.leftSidebarOpen;
      void app.persistSettings();
      return true;
    case "toggleRightSidebar":
      dock.toggle();
      return true;
    // A surface's shortcut reveals it (opening the dock if needed); closing is
    // the dock toggle's job, so pressing one twice never hides what you asked for.
    case "dockFiles":
    case "dockGit":
    case "dockGithub": {
      const surface = id === "dockFiles" ? "files" : id === "dockGit" ? "git" : "github";
      if (!dock.has(surface)) return false;
      dock.show(surface);
      return true;
    }
    case "dockBrowser":
      if (!dock.has("browser")) return false;
      void app.openBrowser().catch(() => {});
      return true;
    case "saveFile":
      return false; // handled by the editor's own CodeMirror keymap when focused
    default:
      return false;
  }
}
