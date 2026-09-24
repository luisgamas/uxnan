// The chord model: how a key combination is written, read from an event,
// compared and drawn. Pure — no app state — so every rule here is unit-tested.
//
// A chord is a `+`-joined string, modifiers first in a fixed order and the key
// last: `Mod+Shift+P`, `Ctrl+Tab`, `Alt+ArrowRight`. `Mod` is the platform's
// primary modifier — ⌘ on macOS, Ctrl on Windows and Linux — so one binding
// means the natural thing on every platform. `Ctrl` is the literal Control key;
// off macOS it *is* the primary modifier, so it normalizes to `Mod` there.

export const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

/** Modifier tokens, in the order a canonical chord writes them. */
const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIERS)[number];

/** A chord taken apart. `key` is a single uppercase character or a key name
 *  (`Tab`, `ArrowRight`, `F5`, `,`). */
export interface ParsedChord {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/** Take a chord apart, or null for an empty or modifier-only one. Accepts the
 *  spellings people type (`Control`, `Option`, `Cmd`) as well as ours. */
export function parseChord(chord: string, mac: boolean = isMac): ParsedChord | null {
  if (!chord) return null;
  const out: ParsedChord = { mod: false, ctrl: false, alt: false, shift: false, key: "" };
  // A trailing "+" is the plus key itself ("Mod++").
  const parts = chord.endsWith("++") ? [...chord.slice(0, -2).split("+"), "+"] : chord.split("+");
  for (const raw of parts) {
    switch (raw) {
      case "Mod":
      case "Cmd":
      case "Meta":
        out.mod = true;
        break;
      case "Ctrl":
      case "Control":
        // Off macOS the Control key is the primary modifier.
        if (mac) out.ctrl = true;
        else out.mod = true;
        break;
      case "Alt":
      case "Option":
        out.alt = true;
        break;
      case "Shift":
        out.shift = true;
        break;
      default:
        out.key = raw.length === 1 ? raw.toUpperCase() : raw;
    }
  }
  return out.key ? out : null;
}

/** Write a parsed chord back in canonical form. */
export function writeChord(c: ParsedChord): string {
  const flags: Record<Modifier, boolean> = { Mod: c.mod, Ctrl: c.ctrl, Alt: c.alt, Shift: c.shift };
  return [...MODIFIERS.filter((m) => flags[m]), c.key].join("+");
}

/** The canonical spelling of a chord on a platform (`""` for none), so two
 *  chords compare with `===`: `Ctrl+Tab` is `Mod+Tab` off macOS, and the
 *  modifiers always come in the same order. */
export function normalizeChord(chord: string, mac: boolean = isMac): string {
  const parsed = parseChord(chord, mac);
  return parsed ? writeChord(parsed) : "";
}

/** Names of keys that aren't a printable single character. */
function keyName(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta" || k === "Dead") return null;
  if (k === " ") return "Space";
  if (k.length === 1) {
    // Option on macOS (and AltGr elsewhere) turns a letter into another
    // character — ⌥⌘S reports "ß". A shortcut names the key, so fall back to
    // the physical letter or digit when the character is not one.
    if (e.altKey && !/^[a-z0-9]$/i.test(k)) {
      const code = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code ?? "");
      if (code) return code[1] ?? code[2];
    }
    return k.toUpperCase();
  }
  return k; // Escape, Enter, Tab, ArrowUp, F1, …
}

/** The canonical chord of a keyboard event, or null when only modifier keys are
 *  held. */
export function eventToChord(e: KeyboardEvent, mac: boolean = isMac): string | null {
  const key = keyName(e);
  if (!key) return null;
  return writeChord({
    mod: mac ? e.metaKey : e.ctrlKey,
    // The Control key is its own modifier only on macOS.
    ctrl: mac && e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key,
  });
}

/** Human-readable chord for display (Mod → Ctrl or ⌘; "" for none). */
export function formatChord(chord: string, mac: boolean = isMac): string {
  return formatChordParts(chord, mac).join("+");
}

/** Apple's symbols for the keys a chord can name, and the order it writes the
 *  modifiers in: ⌃ ⌥ ⇧ ⌘, then the key. The symbols are what a Mac user reads;
 *  the order is Apple's. What we do *not* copy is the menu bar's run-together
 *  `⇧⌘→`: every chord here is drawn as one keycap per key, joined by a `+`, and
 *  that separation is what makes a combo legible in a settings list rather than
 *  a glyph soup. Same shape on every platform — only the tokens change. */
const MAC_SYMBOLS: Record<string, string> = {
  Tab: "⇥",
  Enter: "↩",
  Escape: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  Space: "␣",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** The display tokens of a chord: one per key, so the UI can draw each as its
 *  own keycap joined by a faint `+` — `Ctrl` `+` `Shift` `+` `N`. On macOS the
 *  modifiers take Apple's symbols and order (⌃ ⌥ ⇧ ⌘) and named keys become
 *  glyphs (⇥, →). `[]` for an empty chord. */
export function formatChordParts(chord: string, mac: boolean = isMac): string[] {
  const c = parseChord(chord, mac);
  if (!c) return [];
  if (!mac) {
    return [
      ...(c.mod ? ["Ctrl"] : []),
      ...(c.alt ? ["Alt"] : []),
      ...(c.shift ? ["Shift"] : []),
      c.key,
    ];
  }
  return [
    ...(c.ctrl ? ["⌃"] : []),
    ...(c.alt ? ["⌥"] : []),
    ...(c.shift ? ["⇧"] : []),
    ...(c.mod ? ["⌘"] : []),
    MAC_SYMBOLS[c.key] ?? c.key,
  ];
}

/** Convert a chord to a CodeMirror key name (`Mod+Shift+S` → `Mod-Shift-s`), or
 *  null when it's empty. */
export function toCodeMirrorKey(chord: string, mac: boolean = isMac): string | null {
  const c = parseChord(chord, mac);
  if (!c) return null;
  const mods = [
    ...(c.mod ? ["Mod"] : []),
    ...(c.ctrl ? ["Ctrl"] : []),
    ...(c.alt ? ["Alt"] : []),
    ...(c.shift ? ["Shift"] : []),
  ];
  return [...mods, c.key.length === 1 ? c.key.toLowerCase() : c.key].join("-");
}
