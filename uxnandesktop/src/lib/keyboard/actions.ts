// The registry of the app's keyboard actions: what each one is called, where it
// is listed, its default chord per platform, where it can run from and who wins
// its chord while a terminal has focus. Pure data — the settings view, the
// router, the native layer and the menus all read it from here.

import type { MessageKey } from "$lib/i18n/locales/en";

/** Which side wins a chord while a terminal is focused: `app` = the Uxnan
 *  action runs, `terminal` = the key goes to the shell / TUI / agent. */
export type TerminalPolicy = "app" | "terminal";

/** A group the shortcuts settings list is organized under. */
export type ShortcutCategory = "general" | "navigation" | "panels" | "terminal" | "editor";

/** Section titles, in display order (Settings → Keyboard shortcuts). */
export const SHORTCUT_CATEGORIES: { id: ShortcutCategory; titleKey: MessageKey }[] = [
  { id: "general", titleKey: "shortcuts.catGeneral" },
  { id: "navigation", titleKey: "shortcuts.catNavigation" },
  { id: "panels", titleKey: "shortcuts.catPanels" },
  { id: "terminal", titleKey: "shortcuts.catTerminal" },
  { id: "editor", titleKey: "shortcuts.catEditor" },
];

/** A default chord: one for every platform, or one for macOS and one for the
 *  rest when a platform already uses the natural chord for something else. */
export type PlatformChord = string | { mac: string; other: string };

/** Where an action's chord is heard.
 *  - `global`: anywhere in the window — including a focused browser page, whose
 *    keys never reach the app's UI and are routed natively (`src-tauri/src/keyboard.rs`).
 *  - `focused`: acts on what has focus (the tab, the split, the editor), so it is
 *    heard only in the app's UI. */
export type ActionScope = "global" | "focused";

/** Where a `global` action sits in the macOS menu bar (the platform's place for
 *  an app's commands, and what makes them work from a browser page there). */
export type MenuPlacement = "app" | "file" | "view";

/** An action the user can rebind. `id` is the persisted key. */
export interface KeyAction {
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey;
  category: ShortcutCategory;
  default: PlatformChord;
  scope: ActionScope;
  /** Who wins the chord in a focused terminal unless the person chose. On
   *  macOS a `Mod` chord always wins by default (`defaultTerminalPolicy`). */
  terminal: TerminalPolicy;
  /** Its macOS menu-bar placement (global actions only). */
  menu?: MenuPlacement;
}

export const KEY_ACTIONS: KeyAction[] = [
  {
    id: "openSettings",
    labelKey: "shortcuts.openSettings",
    descKey: "shortcuts.openSettingsDesc",
    category: "general",
    default: "Mod+,",
    scope: "global",
    terminal: "app",
    menu: "app",
  },
  {
    id: "openQuickCommands",
    labelKey: "shortcuts.openQuickCommands",
    descKey: "shortcuts.openQuickCommandsDesc",
    category: "general",
    default: "Mod+Shift+P",
    scope: "global",
    terminal: "app",
    menu: "view",
  },
  {
    id: "openAutomations",
    labelKey: "shortcuts.openAutomations",
    descKey: "shortcuts.openAutomationsDesc",
    category: "general",
    default: "Mod+Shift+A",
    scope: "global",
    terminal: "app",
    menu: "view",
  },
  {
    id: "worktreePalette",
    labelKey: "shortcuts.worktreePalette",
    descKey: "shortcuts.worktreePaletteDesc",
    category: "navigation",
    default: "Mod+P",
    scope: "global",
    // Ctrl+P is the shell's history-up.
    terminal: "terminal",
    menu: "view",
  },
  {
    id: "addProject",
    labelKey: "shortcuts.addProject",
    descKey: "shortcuts.addProjectDesc",
    category: "navigation",
    default: "Mod+O",
    scope: "global",
    // Ctrl+O is readline's operate-and-get-next.
    terminal: "terminal",
    menu: "file",
  },
  {
    id: "newWorktree",
    labelKey: "shortcuts.newWorktree",
    descKey: "shortcuts.newWorktreeDesc",
    category: "navigation",
    default: "Mod+Shift+N",
    scope: "global",
    terminal: "app",
    menu: "file",
  },
  {
    id: "toggleLeftSidebar",
    labelKey: "shortcuts.toggleLeftSidebar",
    descKey: "shortcuts.toggleLeftSidebarDesc",
    category: "panels",
    default: "Mod+B",
    scope: "global",
    // Ctrl+B is the tmux prefix.
    terminal: "terminal",
    menu: "view",
  },
  {
    id: "toggleRightSidebar",
    labelKey: "shortcuts.toggleRightSidebar",
    descKey: "shortcuts.toggleRightSidebarDesc",
    category: "panels",
    default: "Mod+J",
    scope: "global",
    // Ctrl+J is a newline.
    terminal: "terminal",
    menu: "view",
  },
  {
    id: "dockFiles",
    labelKey: "shortcuts.dockFiles",
    descKey: "shortcuts.dockFilesDesc",
    category: "panels",
    default: "Mod+Shift+E",
    scope: "global",
    terminal: "app",
    menu: "view",
  },
  {
    id: "dockGit",
    labelKey: "shortcuts.dockGit",
    descKey: "shortcuts.dockGitDesc",
    category: "panels",
    default: "Mod+Shift+G",
    scope: "global",
    terminal: "app",
    menu: "view",
  },
  {
    id: "dockGithub",
    labelKey: "shortcuts.dockGithub",
    descKey: "shortcuts.dockGithubDesc",
    category: "panels",
    default: "Mod+Shift+H",
    scope: "global",
    terminal: "app",
    menu: "view",
  },
  {
    id: "dockBrowser",
    labelKey: "shortcuts.dockBrowser",
    descKey: "shortcuts.dockBrowserDesc",
    category: "panels",
    default: "Mod+Shift+B",
    scope: "global",
    terminal: "app",
    menu: "view",
  },
  {
    id: "newTerminal",
    labelKey: "shortcuts.newTerminal",
    descKey: "shortcuts.newTerminalDesc",
    category: "terminal",
    default: "Mod+T",
    scope: "global",
    terminal: "app",
    menu: "file",
  },
  {
    id: "newGlobalTerminal",
    labelKey: "shortcuts.newGlobalTerminal",
    descKey: "shortcuts.newGlobalTerminalDesc",
    category: "terminal",
    default: "Mod+Shift+T",
    scope: "global",
    terminal: "app",
    menu: "file",
  },
  {
    id: "splitRight",
    labelKey: "shortcuts.splitRight",
    descKey: "shortcuts.splitRightDesc",
    category: "terminal",
    default: "Mod+Shift+ArrowRight",
    scope: "focused",
    terminal: "app",
  },
  {
    id: "splitDown",
    labelKey: "shortcuts.splitDown",
    descKey: "shortcuts.splitDownDesc",
    category: "terminal",
    default: "Mod+Shift+ArrowDown",
    scope: "focused",
    terminal: "app",
  },
  {
    // ⌘Tab is macOS's app switcher and never reaches an app, so the default is
    // the Control key on every platform (Ctrl+Tab, the tab-cycling convention).
    id: "cycleTabNext",
    labelKey: "shortcuts.cycleTabNext",
    descKey: "shortcuts.cycleTabNextDesc",
    category: "terminal",
    default: "Ctrl+Tab",
    scope: "focused",
    terminal: "app",
  },
  {
    id: "cycleTabPrev",
    labelKey: "shortcuts.cycleTabPrev",
    descKey: "shortcuts.cycleTabPrevDesc",
    category: "terminal",
    default: "Ctrl+Shift+Tab",
    scope: "focused",
    terminal: "app",
  },
  {
    // Sleeping a workspace kills its shells and idle agents, so it has no
    // default: a chord you can hit by accident (it used to be Redo's) must not
    // do that. Assign one in Settings, or use the worktree row's menu.
    id: "sleepWorkspace",
    labelKey: "shortcuts.sleepWorkspace",
    descKey: "shortcuts.sleepWorkspaceDesc",
    category: "terminal",
    default: "",
    scope: "focused",
    terminal: "terminal",
  },
  {
    // Ctrl+Alt+arrows switch desktops on GNOME and rotate the screen on some
    // Windows graphics drivers, so off macOS the default is Alt+arrow — what
    // terminal apps there use to move between panes.
    id: "focusSplitNext",
    labelKey: "shortcuts.focusSplitNext",
    descKey: "shortcuts.focusSplitNextDesc",
    category: "terminal",
    default: { mac: "Mod+Alt+ArrowRight", other: "Alt+ArrowRight" },
    scope: "focused",
    terminal: "app",
  },
  {
    id: "focusSplitPrev",
    labelKey: "shortcuts.focusSplitPrev",
    descKey: "shortcuts.focusSplitPrevDesc",
    category: "terminal",
    default: { mac: "Mod+Alt+ArrowLeft", other: "Alt+ArrowLeft" },
    scope: "focused",
    terminal: "app",
  },
  {
    id: "closeCenter",
    labelKey: "shortcuts.closeCenter",
    descKey: "shortcuts.closeCenterDesc",
    category: "terminal",
    default: "Mod+W",
    scope: "focused",
    // Ctrl+W is the shell's delete-word.
    terminal: "terminal",
  },
  {
    // ⌘K clears a terminal on macOS. Off macOS Ctrl+K is the shell's kill-line,
    // so there the key goes to the shell unless the person chooses otherwise.
    id: "clearTerminal",
    labelKey: "shortcuts.clearTerminal",
    descKey: "shortcuts.clearTerminalDesc",
    category: "terminal",
    default: "Mod+K",
    scope: "focused",
    terminal: "terminal",
  },
  {
    id: "saveFile",
    labelKey: "shortcuts.saveFile",
    descKey: "shortcuts.saveFileDesc",
    category: "editor",
    default: "Mod+S",
    scope: "focused",
    // Ctrl+S is XOFF.
    terminal: "terminal",
  },
  {
    // Toggles "focus mode" on the active terminal: while on, every key goes to
    // the TUI/agent (even reserved Uxnan shortcuts). No default chord — assign
    // one or use the on-terminal badge. Always wins in a terminal so it can turn
    // itself back off.
    id: "toggleTerminalPassthrough",
    labelKey: "shortcuts.toggleTerminalPassthrough",
    descKey: "shortcuts.toggleTerminalPassthroughDesc",
    category: "terminal",
    default: "",
    scope: "focused",
    terminal: "app",
  },
];

const BY_ID = new Map(KEY_ACTIONS.map((a) => [a.id, a]));

/** An action by id. */
export function actionById(id: string): KeyAction | undefined {
  return BY_ID.get(id);
}

/** An action's default chord on a platform (`""` = none). */
export function defaultChordOf(action: KeyAction, mac: boolean): string {
  const d = action.default;
  return typeof d === "string" ? d : mac ? d.mac : d.other;
}

/** `KEY_ACTIONS` grouped by category, in `SHORTCUT_CATEGORIES` order (empty
 *  groups omitted). Drives the sectioned settings list. */
export const SHORTCUT_GROUPS: { titleKey: MessageKey; actions: KeyAction[] }[] =
  SHORTCUT_CATEGORIES.map((c) => ({
    titleKey: c.titleKey,
    actions: KEY_ACTIONS.filter((a) => a.category === c.id),
  })).filter((g) => g.actions.length > 0);
