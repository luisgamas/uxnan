// The keyboard, wired to the app: the person's bindings and choices applied to
// the pure registry and router, the two places a key is heard in the UI (the
// window, and each terminal's xterm hook), and the native layer that hears the
// global shortcuts where the UI cannot — a focused browser page — and puts the
// app's commands in the macOS menu bar.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { app } from "$lib/state/app.svelte";
import { i18n } from "$lib/i18n";
import { KEY_ACTIONS, actionById, defaultChordOf, type MenuPlacement, type TerminalPolicy } from "./actions";
import { eventToChord, isMac, normalizeChord } from "./chords";
import { defaultTerminalPolicy, focusContextOf, routeKey, type KeyDisposition, type TerminalState } from "./router";
import { runAppAction } from "./run";

/** An action's active chord, canonical (custom override, else the platform
 *  default; `""` = none). */
export function resolveBinding(id: string): string {
  const custom = app.settings.keybindings?.[id];
  if (custom !== undefined) return normalizeChord(custom);
  const action = actionById(id);
  return action ? normalizeChord(defaultChordOf(action, isMac)) : "";
}

/** The action bound to a chord, or null. */
export function actionForChord(chord: string | null): string | null {
  if (!chord) return null;
  for (const a of KEY_ACTIONS) {
    if (resolveBinding(a.id) === chord) return a.id;
  }
  return null;
}

/** Who wins an action's chord in a focused terminal: the person's choice, else
 *  the registry's default for that chord on this platform. */
export function resolveTerminalPolicy(id: string): TerminalPolicy {
  const custom = app.settings.terminalKeyPolicy?.[id];
  if (custom === "app" || custom === "terminal") return custom;
  return defaultTerminalPolicy(actionById(id)?.terminal ?? "terminal", resolveBinding(id), isMac);
}

/** The leader chord (`""` = off). In a focused terminal it sends the *next*
 *  shortcut to Uxnan whatever its policy — a tmux-style escape hatch. */
export function resolveLeaderChord(): string {
  return normalizeChord(app.settings.leaderKey ?? "");
}

/** Route a keydown the window heard (everything but a terminal, whose xterm
 *  hook routes its own keys first). Full-screen views (Settings, Automations)
 *  own their keys. */
export function handleWindowKey(e: KeyboardEvent): void {
  if (app.settingsOpen || app.automationsOpen) return;
  const context = focusContextOf(e.target);
  if (context === "terminal") return;
  const chord = eventToChord(e);
  if (!chord) return;
  const action = actionForChord(chord);
  const disposition = routeKey({
    context,
    chord,
    action,
    policy: "app",
    handled: e.defaultPrevented,
    isLeader: false,
    mac: isMac,
  });
  if (disposition.kind === "app" && runAppAction(disposition.action)) e.preventDefault();
}

/** Route a keydown in a focused terminal. The caller acts on the result:
 *  runs an `app` action (with its terminal id), toggles focus mode, arms the
 *  leader, or lets xterm have the key. */
export function routeTerminalKey(e: KeyboardEvent, terminal: TerminalState): KeyDisposition {
  const chord = eventToChord(e);
  if (!chord) return { kind: "surface", claim: false };
  const action = actionForChord(chord);
  return routeKey({
    context: "terminal",
    chord,
    action,
    policy: action ? resolveTerminalPolicy(action) : "terminal",
    handled: false,
    isLeader: chord === resolveLeaderChord(),
    terminal,
    mac: isMac,
  });
}

// --- The native layer -------------------------------------------------------

/** A global command as the native layer receives it. */
export interface NativeCommand {
  id: string;
  chord: string;
  label: string;
  menu: MenuPlacement | null;
}

/** The global commands with a chord, for the native layer. */
export function nativeCommands(): NativeCommand[] {
  return KEY_ACTIONS.filter((a) => a.scope === "global").map((a) => ({
    id: a.id,
    chord: resolveBinding(a.id),
    label: i18n.t(a.labelKey),
    menu: a.menu ?? null,
  }));
}

/** The words of the macOS menu bar, in the app's language. */
function menuLabels(): Record<string, string> {
  return {
    about: i18n.t("menu.about"),
    services: i18n.t("menu.services"),
    hide: i18n.t("menu.hide"),
    hideOthers: i18n.t("menu.hideOthers"),
    showAll: i18n.t("menu.showAll"),
    quit: i18n.t("menu.quit"),
    file: i18n.t("menu.file"),
    closeWindow: i18n.t("menu.closeWindow"),
    edit: i18n.t("menu.edit"),
    undo: i18n.t("menu.undo"),
    redo: i18n.t("menu.redo"),
    cut: i18n.t("menu.cut"),
    copy: i18n.t("menu.copy"),
    paste: i18n.t("menu.paste"),
    selectAll: i18n.t("menu.selectAll"),
    view: i18n.t("menu.view"),
    fullscreen: i18n.t("menu.fullscreen"),
    window: i18n.t("menu.window"),
    minimize: i18n.t("menu.minimize"),
    zoom: i18n.t("menu.zoom"),
  };
}

let started = false;

/** Keep the native layer in step with the bindings and the language, and run
 *  the global actions it hears. Idempotent; a no-op outside Tauri. */
export function startNativeKeyboard(): void {
  if (started) return;
  started = true;
  $effect.root(() => {
    $effect(() => {
      const payload = { commands: nativeCommands(), labels: menuLabels() };
      invoke("keyboard_set_commands", payload).catch(() => {
        // No backend (the web preview): the UI still hears every key itself.
      });
    });
  });
  listen<{ id: string }>("keyboard:action", (e) => {
    if (actionById(e.payload.id)?.scope === "global") runAppAction(e.payload.id);
  }).catch(() => {});
}
