import { describe, expect, it } from "vitest";

import { eventToChord, formatChordParts, normalizeChord, parseChord, toCodeMirrorKey } from "./chords";

// A chord is drawn as one keycap per key, joined by a `+`, on every platform —
// that separation is what keeps a combo readable in a settings list. What macOS
// changes is the tokens, not the shape: it used to leave "Shift" and
// "ArrowRight" spelled out in English next to a ⌘ symbol.

describe("formatChordParts — Windows / Linux", () => {
  it("spells the keys out, one token each", () => {
    expect(formatChordParts("Mod+Shift+N", false)).toEqual(["Ctrl", "Shift", "N"]);
    expect(formatChordParts("Mod+,", false)).toEqual(["Ctrl", ","]);
    expect(formatChordParts("Mod+Alt+ArrowRight", false)).toEqual([
      "Ctrl",
      "Alt",
      "ArrowRight",
    ]);
  });
});

describe("formatChordParts — macOS", () => {
  it("keeps one token per key, so the UI still joins them with +", () => {
    expect(formatChordParts("Mod+S", true)).toEqual(["⌘", "S"]);
    expect(formatChordParts("Mod+,", true)).toEqual(["⌘", ","]);
  });

  it("uses Apple's modifier symbols and their canonical order", () => {
    // Apple orders ⌃ ⌥ ⇧ ⌘ regardless of how the binding was written.
    expect(formatChordParts("Mod+Shift+N", true)).toEqual(["⇧", "⌘", "N"]);
    expect(formatChordParts("Shift+Mod+N", true)).toEqual(["⇧", "⌘", "N"]);
    expect(formatChordParts("Mod+Alt+ArrowLeft", true)).toEqual(["⌥", "⌘", "←"]);
    expect(formatChordParts("Ctrl+Alt+Shift+Mod+K", true)).toEqual(["⌃", "⌥", "⇧", "⌘", "K"]);
  });

  it("draws named keys as glyphs instead of spelling them", () => {
    expect(formatChordParts("Mod+Tab", true)).toEqual(["⌘", "⇥"]);
    expect(formatChordParts("Mod+Shift+ArrowDown", true)).toEqual(["⇧", "⌘", "↓"]);
    expect(formatChordParts("Mod+Shift+Tab", true)).toEqual(["⇧", "⌘", "⇥"]);
  });

  it("upper-cases a letter but leaves an unmapped key name alone", () => {
    expect(formatChordParts("Mod+s", true)).toEqual(["⌘", "S"]);
    expect(formatChordParts("Mod+PageDown", true)).toEqual(["⌘", "PageDown"]);
  });
});

describe("formatChordParts — either platform", () => {
  it("has nothing to draw for an unbound action", () => {
    expect(formatChordParts("", true)).toEqual([]);
    expect(formatChordParts("", false)).toEqual([]);
  });
});

describe("normalizeChord", () => {
  it("writes the modifiers in one order, so chords compare with ===", () => {
    expect(normalizeChord("Shift+Mod+n", true)).toBe("Mod+Shift+N");
    expect(normalizeChord("Alt+Ctrl+Mod+K", true)).toBe("Mod+Ctrl+Alt+K");
  });

  it("reads the Control key as the primary modifier off macOS", () => {
    expect(normalizeChord("Ctrl+Tab", false)).toBe("Mod+Tab");
    expect(normalizeChord("Ctrl+Tab", true)).toBe("Ctrl+Tab");
  });

  it("accepts the spellings people type, and the plus key", () => {
    expect(normalizeChord("Cmd+Option+S", true)).toBe("Mod+Alt+S");
    expect(normalizeChord("Mod++", false)).toBe("Mod++");
    expect(parseChord("Mod++", false)?.key).toBe("+");
  });

  it("has nothing for an empty or modifier-only chord", () => {
    expect(normalizeChord("", true)).toBe("");
    expect(normalizeChord("Mod+Shift", true)).toBe("");
  });
});

describe("eventToChord", () => {
  const ev = (init: KeyboardEventInit & { key: string; code?: string }) => init as unknown as KeyboardEvent;

  it("maps ⌘ to Mod on macOS and keeps Control apart", () => {
    expect(eventToChord(ev({ key: "w", metaKey: true }), true)).toBe("Mod+W");
    expect(eventToChord(ev({ key: "Tab", ctrlKey: true }), true)).toBe("Ctrl+Tab");
  });

  it("maps Control to Mod off macOS", () => {
    expect(eventToChord(ev({ key: "Tab", ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+Tab");
  });

  it("names the key, not the character Option or AltGr typed", () => {
    expect(eventToChord(ev({ key: "ß", code: "KeyS", metaKey: true, altKey: true }), true)).toBe("Mod+Alt+S");
    expect(eventToChord(ev({ key: "¡", code: "Digit1", altKey: true }), true)).toBe("Alt+1");
  });

  it("ignores a lone modifier", () => {
    expect(eventToChord(ev({ key: "Shift", shiftKey: true }), true)).toBeNull();
  });
});

describe("toCodeMirrorKey", () => {
  it("writes CodeMirror's key names", () => {
    expect(toCodeMirrorKey("Mod+Shift+S", true)).toBe("Mod-Shift-s");
    expect(toCodeMirrorKey("", true)).toBeNull();
  });
});
