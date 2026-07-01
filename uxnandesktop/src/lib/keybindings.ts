// Configurable keyboard shortcuts.
//
// Each action has a default chord; the user can override it in Settings →
// Keyboard shortcuts (persisted in `AppSettings.keybindings`). Chords are stored
// platform-agnostically with the `Mod` token (Ctrl on Windows/Linux, ⌘ on
// macOS); the matcher resolves `Mod` against the real event. An empty override
// ("") disables the action.

import { app } from "$lib/state/app.svelte";
import type { MessageKey } from "$lib/i18n/locales/en";

export const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

/** A group the shortcuts settings list is organized under. */
export type ShortcutCategory =
  | "general"
  | "navigation"
  | "panels"
  | "terminal"
  | "editor";

/** Section titles, in display order (Settings → Keyboard shortcuts). */
export const SHORTCUT_CATEGORIES: { id: ShortcutCategory; titleKey: MessageKey }[] = [
  { id: "general", titleKey: "shortcuts.catGeneral" },
  { id: "navigation", titleKey: "shortcuts.catNavigation" },
  { id: "panels", titleKey: "shortcuts.catPanels" },
  { id: "terminal", titleKey: "shortcuts.catTerminal" },
  { id: "editor", titleKey: "shortcuts.catEditor" },
];

/** An action the user can rebind. `id` is the persisted key. */
export interface KeyAction {
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey;
  /** Which section it appears under in the settings list. */
  category: ShortcutCategory;
  /** Default chord (platform-agnostic, `Mod` = Ctrl/⌘). */
  default: string;
}

export const KEY_ACTIONS: KeyAction[] = [
  {
    id: "openSettings",
    labelKey: "shortcuts.openSettings",
    descKey: "shortcuts.openSettingsDesc",
    category: "general",
    default: "Mod+,",
  },
  {
    id: "worktreePalette",
    labelKey: "shortcuts.worktreePalette",
    descKey: "shortcuts.worktreePaletteDesc",
    category: "navigation",
    default: "Mod+P",
  },
  {
    id: "addProject",
    labelKey: "shortcuts.addProject",
    descKey: "shortcuts.addProjectDesc",
    category: "navigation",
    default: "Mod+O",
  },
  {
    id: "newWorktree",
    labelKey: "shortcuts.newWorktree",
    descKey: "shortcuts.newWorktreeDesc",
    category: "navigation",
    default: "Mod+Shift+N",
  },
  {
    id: "toggleLeftSidebar",
    labelKey: "shortcuts.toggleLeftSidebar",
    descKey: "shortcuts.toggleLeftSidebarDesc",
    category: "panels",
    default: "Mod+B",
  },
  {
    id: "toggleRightSidebar",
    labelKey: "shortcuts.toggleRightSidebar",
    descKey: "shortcuts.toggleRightSidebarDesc",
    category: "panels",
    default: "Mod+J",
  },
  {
    id: "newTerminal",
    labelKey: "shortcuts.newTerminal",
    descKey: "shortcuts.newTerminalDesc",
    category: "terminal",
    default: "Mod+T",
  },
  {
    id: "newGlobalTerminal",
    labelKey: "shortcuts.newGlobalTerminal",
    descKey: "shortcuts.newGlobalTerminalDesc",
    category: "terminal",
    default: "Mod+Shift+T",
  },
  {
    id: "splitRight",
    labelKey: "shortcuts.splitRight",
    descKey: "shortcuts.splitRightDesc",
    category: "terminal",
    default: "Mod+Shift+ArrowRight",
  },
  {
    id: "splitDown",
    labelKey: "shortcuts.splitDown",
    descKey: "shortcuts.splitDownDesc",
    category: "terminal",
    default: "Mod+Shift+ArrowDown",
  },
  {
    id: "cycleTabNext",
    labelKey: "shortcuts.cycleTabNext",
    descKey: "shortcuts.cycleTabNextDesc",
    category: "terminal",
    default: "Mod+Tab",
  },
  {
    id: "cycleTabPrev",
    labelKey: "shortcuts.cycleTabPrev",
    descKey: "shortcuts.cycleTabPrevDesc",
    category: "terminal",
    default: "Mod+Shift+Tab",
  },
  {
    id: "focusSplitNext",
    labelKey: "shortcuts.focusSplitNext",
    descKey: "shortcuts.focusSplitNextDesc",
    category: "terminal",
    default: "Mod+Alt+ArrowRight",
  },
  {
    id: "focusSplitPrev",
    labelKey: "shortcuts.focusSplitPrev",
    descKey: "shortcuts.focusSplitPrevDesc",
    category: "terminal",
    default: "Mod+Alt+ArrowLeft",
  },
  {
    id: "closeCenter",
    labelKey: "shortcuts.closeCenter",
    descKey: "shortcuts.closeCenterDesc",
    category: "terminal",
    default: "Mod+W",
  },
  {
    id: "saveFile",
    labelKey: "shortcuts.saveFile",
    descKey: "shortcuts.saveFileDesc",
    category: "editor",
    default: "Mod+S",
  },
];

/** `KEY_ACTIONS` grouped by category, in `SHORTCUT_CATEGORIES` order (empty
 *  groups omitted). Drives the sectioned settings list. */
export const SHORTCUT_GROUPS: { titleKey: MessageKey; actions: KeyAction[] }[] =
  SHORTCUT_CATEGORIES.map((c) => ({
    titleKey: c.titleKey,
    actions: KEY_ACTIONS.filter((a) => a.category === c.id),
  })).filter((g) => g.actions.length > 0);

const DEFAULTS: Record<string, string> = Object.fromEntries(
  KEY_ACTIONS.map((a) => [a.id, a.default]),
);

/** Resolve an action's active chord (custom override, else default; "" = off). */
export function resolveBinding(id: string): string {
  const custom = app.settings.keybindings?.[id];
  return custom !== undefined ? custom : (DEFAULTS[id] ?? "");
}

/** Names of keys that aren't a printable single character. */
function keyName(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta") return null;
  if (k === " ") return "Space";
  if (k.length === 1) return k.toUpperCase();
  return k; // Escape, Enter, Tab, ArrowUp, F1, …
}

/** Build a platform-agnostic chord string from a keyboard event, or null when
 *  only modifier keys are held. */
export function eventToChord(e: KeyboardEvent): string | null {
  const key = keyName(e);
  if (!key) return null;
  const parts: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push("Mod");
  // The non-primary Ctrl on macOS is still meaningful.
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** The action whose active chord matches this event, or null. */
export function matchAction(e: KeyboardEvent): string | null {
  const chord = eventToChord(e);
  if (!chord) return null;
  for (const a of KEY_ACTIONS) {
    const binding = resolveBinding(a.id);
    if (binding && binding === chord) return a.id;
  }
  return null;
}

/** Human-readable chord for display (Mod → Ctrl or ⌘; "" → "Disabled" label up
 *  to the caller). */
export function formatChord(chord: string): string {
  if (!chord) return "";
  return formatChordParts(chord).join(isMac ? "" : "+");
}

/** The display tokens of a chord, one per key (Mod → Ctrl or ⌘). Lets the UI
 *  render each key as its own keycap (e.g. `Ctrl` `+` `,`) instead of cramming
 *  a whole combo into one — far more legible. `[]` for an empty/disabled chord. */
export function formatChordParts(chord: string): string[] {
  if (!chord) return [];
  return chord.split("+").map((p) => (p === "Mod" ? (isMac ? "⌘" : "Ctrl") : p));
}

/** Convert a chord to a CodeMirror key name (`Mod+Shift+S` → `Mod-Shift-s`), or
 *  null when it's empty/disabled. */
export function toCodeMirrorKey(chord: string): string | null {
  if (!chord) return null;
  return chord
    .split("+")
    .map((p) => (p.length === 1 ? p.toLowerCase() : p))
    .join("-");
}
