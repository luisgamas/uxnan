// Who gets a keystroke. One pure decision for every place a key can land in the
// app's UI, so no surface grows its own rules:
//
//  - text      an input, a textarea, anything contenteditable
//  - editor    a CodeMirror file editor
//  - terminal  an xterm (routed from xterm's own key hook, before xterm acts)
//  - app       everything else — lists, buttons, the empty window
//
// A browser page is a separate native webview whose keys never reach this
// code; its global shortcuts are routed natively (`src-tauri/src/keyboard.rs`).

import { parseChord } from "./chords";
import type { TerminalPolicy } from "./actions";

export type FocusContext = "text" | "editor" | "terminal" | "app";

/** Inputs whose keys are not text: toggles and buttons. */
const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Where a key event is landing. */
export function focusContextOf(target: EventTarget | null): FocusContext {
  const el = target instanceof Element ? target : null;
  if (!el) return "app";
  if (el.closest(".xterm")) return "terminal";
  if (el.closest(".cm-editor")) return "editor";
  if (el instanceof HTMLTextAreaElement) return "text";
  if (el instanceof HTMLInputElement) return NON_TEXT_INPUTS.has(el.type) ? "app" : "text";
  if (el instanceof HTMLElement && el.isContentEditable) return "text";
  return "app";
}

/** Keys that move the caret or edit around it, whatever the modifiers. */
const EDITING_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
]);

/** Undo, redo, select all and the clipboard. */
const EDIT_COMMAND_KEYS = new Set(["Z", "Y", "A", "C", "X", "V"]);

/** Whether a field that edits text owns this chord: typing (a key without the
 *  primary modifier — Option and AltGr characters included), caret movement and
 *  selection, deletion, undo/redo, select all and the clipboard — plus, on
 *  macOS, the Control-letter editing keys (⌃A, ⌃E, ⌃K…) and, elsewhere, the
 *  Ctrl+Alt characters AltGr types. A field keeps these even when an app
 *  shortcut uses the same chord: ⌘⇧Z redoes there, ⌘⇧→ selects to the line end. */
export function textOwnsChord(chord: string, mac: boolean): boolean {
  const c = parseChord(chord, mac);
  if (!c) return false;
  if (EDITING_KEYS.has(c.key)) return true;
  const printable = c.key.length === 1 || c.key === "Space";
  if (!c.mod && !c.ctrl) return printable;
  if (c.mod && !c.alt && EDIT_COMMAND_KEYS.has(c.key)) return true;
  if (mac && c.ctrl && !c.mod && /^[A-Z]$/.test(c.key)) return true;
  if (!mac && c.mod && c.alt && printable) return true;
  return false;
}

/** The default terminal-focus policy of an action bound to `chord`. The
 *  registry yields the chords a shell or TUI uses — which are **Ctrl** chords.
 *  On macOS `Mod` is ⌘, and ⌘ never reaches a shell, so there an action bound
 *  through `Mod` always wins: yielding it would only make ⌘W, ⌘B or ⌘S do
 *  nothing while a terminal has focus. */
export function defaultTerminalPolicy(
  registered: TerminalPolicy,
  chord: string,
  mac: boolean,
): TerminalPolicy {
  if (mac && parseChord(chord, mac)?.mod) return "app";
  return registered;
}

/** What should happen to a key. */
export type KeyDisposition =
  | { kind: "app"; action: string } // run the action; swallow the key
  | { kind: "surface"; claim: boolean } // leave it to the focused surface
  | { kind: "passthrough" } // toggle this terminal's focus (passthrough) mode
  | { kind: "leader" }; // arm the leader (swallow it; the next key goes to Uxnan)

/** Transient terminal-keyboard state the router needs. */
export interface TerminalState {
  /** This terminal is in focus/passthrough mode (everything goes to the TUI). */
  passthrough: boolean;
  /** The previous keydown in this terminal was the leader chord. */
  leaderPending: boolean;
}

export interface RouteInput {
  context: FocusContext;
  /** The event's canonical chord. */
  chord: string;
  /** The action bound to that chord, or null. */
  action: string | null;
  /** The action's effective terminal policy (only read in a terminal). */
  policy: TerminalPolicy;
  /** A handler on the focused element already acted on the key. */
  handled: boolean;
  /** This chord is the leader chord. */
  isLeader: boolean;
  /** Terminal state (only read in a terminal). */
  terminal?: TerminalState;
  mac: boolean;
}

/** Route a key. Order matters:
 *  1. In a terminal, the passthrough toggle always wins (you can always leave
 *     focus mode); a pending leader sends the next shortcut to Uxnan whatever
 *     its policy; passthrough sends everything else to the TUI; the leader
 *     arms; otherwise the action's policy decides.
 *  2. Elsewhere, a key a focused widget already handled is left alone (the
 *     editor's own keymap, a menu, a dialog); a text field or the editor keeps
 *     its typing and editing chords; anything else bound runs.
 *
 *  `claim` asks the caller to mark the key handled although nothing in the UI
 *  acts on it. On macOS a ⌘ key nobody handles goes on to the menu bar, which
 *  carries the global actions — so a ⌘ chord left to a terminal (focus mode, or
 *  a person's "the terminal wins" choice) would still run the action. xterm
 *  sends nothing for ⌘, so claiming it loses nothing. */
export function routeKey(input: RouteInput): KeyDisposition {
  const { context, action, mac } = input;
  const parsed = parseChord(input.chord, mac);
  const claimCommand = mac && Boolean(parsed?.mod) && action !== null;

  if (context === "terminal") {
    const t = input.terminal ?? { passthrough: false, leaderPending: false };
    if (action === "toggleTerminalPassthrough") return { kind: "passthrough" };
    if (t.leaderPending) {
      return action ? { kind: "app", action } : { kind: "surface", claim: false };
    }
    if (t.passthrough) return { kind: "surface", claim: claimCommand };
    if (input.isLeader) return { kind: "leader" };
    if (action && input.policy === "app") return { kind: "app", action };
    return { kind: "surface", claim: claimCommand };
  }

  if (input.handled || !action) return { kind: "surface", claim: false };
  if ((context === "text" || context === "editor") && textOwnsChord(input.chord, mac)) {
    return { kind: "surface", claim: false };
  }
  return { kind: "app", action };
}

