import { describe, expect, it } from "vitest";

import { formatChordParts } from "./keybindings";

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
