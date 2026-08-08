import { describe, expect, it } from "vitest";
import {
  TERMINAL_MIN_CONTRAST_DARK,
  TERMINAL_MIN_CONTRAST_LIGHT,
  isBoldTerminalFontWeight,
  isLightTerminalBackground,
  normalizeImportedThemes,
  normalizeImportedTerminalThemes,
  normalizeTerminalFontWeight,
  resolveTerminal,
  resolveTerminalFontWeights,
} from "./theme";

// Minimal valid inputs: normalizeImportedTheme backfills every missing token
// from the matching built-in, so `{ base, colors: {} }` is enough to validate.
const darkTheme = (name: string) => ({ name, base: "dark", colors: {} });
const lightTheme = (name: string) => ({ name, base: "light", colors: {} });

describe("normalizeImportedThemes (UI themes)", () => {
  it("accepts a single theme object", () => {
    const { themes, errors } = normalizeImportedThemes(darkTheme("Solo"));
    expect(themes).toHaveLength(1);
    expect(themes[0].name).toBe("Solo");
    expect(errors).toEqual([]);
  });

  it("accepts a bare array of themes", () => {
    const { themes, errors } = normalizeImportedThemes([darkTheme("A"), lightTheme("B")]);
    expect(themes.map((t) => t.name)).toEqual(["A", "B"]);
    expect(errors).toEqual([]);
  });

  it("accepts a { themes: [...] } wrapper", () => {
    const { themes, errors } = normalizeImportedThemes({ themes: [darkTheme("A"), darkTheme("B")] });
    expect(themes).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("assigns a fresh unique id to every imported theme", () => {
    const { themes } = normalizeImportedThemes([darkTheme("A"), darkTheme("B")]);
    expect(themes[0].id).not.toBe(themes[1].id);
  });

  it("keeps valid entries and reports errors for invalid ones", () => {
    const { themes, errors } = normalizeImportedThemes([darkTheme("Good"), { colors: {} }, "nope"]);
    expect(themes).toHaveLength(1);
    expect(themes[0].name).toBe("Good");
    expect(errors).toHaveLength(2);
  });

  it("returns an error for a non-object, non-array input", () => {
    const { themes, errors } = normalizeImportedThemes(42);
    expect(themes).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("normalizeImportedTerminalThemes (terminal themes)", () => {
  it("accepts a single preset object", () => {
    const { presets, errors } = normalizeImportedTerminalThemes({ name: "Solo", background: "#000" });
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe("Solo");
    expect(errors).toEqual([]);
  });

  it("accepts a bare array of presets", () => {
    const { presets } = normalizeImportedTerminalThemes([{ name: "A" }, { name: "B" }]);
    expect(presets.map((p) => p.name)).toEqual(["A", "B"]);
  });

  it("accepts a { terminalThemes: [...] } wrapper", () => {
    const { presets } = normalizeImportedTerminalThemes({ terminalThemes: [{ name: "A" }, { name: "B" }] });
    expect(presets).toHaveLength(2);
  });

  it("assigns a fresh unique id to every imported preset", () => {
    const { presets } = normalizeImportedTerminalThemes([{ name: "A" }, { name: "B" }]);
    expect(presets[0].id).not.toBe(presets[1].id);
  });

  it("keeps valid presets and reports errors for invalid entries", () => {
    const { presets, errors } = normalizeImportedTerminalThemes([{ name: "Good" }, "nope"]);
    expect(presets).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("returns an error for a non-object, non-array input", () => {
    const { presets, errors } = normalizeImportedTerminalThemes(null);
    expect(presets).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("isLightTerminalBackground", () => {
  it("reads hex, short hex and rgb() backgrounds", () => {
    expect(isLightTerminalBackground("#ffffff", false)).toBe(true);
    expect(isLightTerminalBackground("#0b0b0c", true)).toBe(false);
    expect(isLightTerminalBackground("#fff", false)).toBe(true);
    expect(isLightTerminalBackground("rgb(250, 250, 250)", false)).toBe(true);
    expect(isLightTerminalBackground("rgba(12, 12, 14, 1)", true)).toBe(false);
    expect(isLightTerminalBackground("black", true)).toBe(false);
    expect(isLightTerminalBackground("white", false)).toBe(true);
  });

  it("falls back to the app base for a color it can't parse", () => {
    expect(isLightTerminalBackground("oklch(0.145 0 0)", true)).toBe(true);
    expect(isLightTerminalBackground(undefined, false)).toBe(false);
    expect(isLightTerminalBackground("", true)).toBe(true);
  });
});

describe("resolveTerminal — defaults follow the background, not the app base", () => {
  it("keeps a dark preset legible under a light app theme", () => {
    // The bug this guards: inheriting the LIGHT base's text + ANSI defaults onto
    // a dark preset background left unset fields the same color as the terminal.
    const t = resolveTerminal("light", { background: "#0b0b0c" });
    expect(t.theme.foreground).toBe("#e6e6e6");
    expect(t.theme.brightWhite).toBe("#ffffff");
    expect(t.minimumContrastRatio).toBe(TERMINAL_MIN_CONTRAST_DARK);
  });

  it("keeps a light preset legible under a dark app theme", () => {
    const t = resolveTerminal("dark", { background: "#ffffff" });
    expect(t.theme.foreground).toBe("#1f2328");
    expect(t.theme.white).toBe("#6e7781");
    expect(t.minimumContrastRatio).toBe(TERMINAL_MIN_CONTRAST_LIGHT);
  });

  it("uses the app base when no override sets a background", () => {
    expect(resolveTerminal("dark", null).theme.background).toBe("#0b0b0c");
    expect(resolveTerminal("light", null).theme.background).toBe("#ffffff");
    expect(resolveTerminal("light", null).minimumContrastRatio).toBe(TERMINAL_MIN_CONTRAST_LIGHT);
  });

  it("still honors every color the preset does set", () => {
    const t = resolveTerminal("light", { background: "#101014", foreground: "#c0ffee", red: "#ff0000" });
    expect(t.theme.foreground).toBe("#c0ffee");
    expect(t.theme.red).toBe("#ff0000");
    expect(t.theme.cursorAccent).toBe("#101014");
  });
});

describe("terminal font weight", () => {
  it("normalizes numbers, numeric strings and the CSS keywords", () => {
    expect(normalizeTerminalFontWeight(500)).toBe(500);
    expect(normalizeTerminalFontWeight("600")).toBe(600);
    expect(normalizeTerminalFontWeight("normal")).toBe(400);
    expect(normalizeTerminalFontWeight("bold")).toBe(700);
    expect(normalizeTerminalFontWeight(1200)).toBe(900);
    expect(normalizeTerminalFontWeight(430)).toBe(400);
  });

  it("falls back to the default weight for anything unusable", () => {
    expect(normalizeTerminalFontWeight(undefined)).toBe(300);
    expect(normalizeTerminalFontWeight("heavy")).toBe(300);
    expect(normalizeTerminalFontWeight(0)).toBe(300);
    expect(normalizeTerminalFontWeight(NaN)).toBe(300);
  });

  it("keeps bold output heavier than the regular weight", () => {
    expect(resolveTerminalFontWeights(300)).toEqual({ fontWeight: 300, fontWeightBold: 700 });
    expect(resolveTerminalFontWeights("bold")).toEqual({ fontWeight: 700, fontWeightBold: 900 });
    expect(resolveTerminalFontWeights(800)).toEqual({ fontWeight: 800, fontWeightBold: 900 });
  });

  it("reports which weights read as bold (what the switch shows)", () => {
    expect(isBoldTerminalFontWeight(700)).toBe(true);
    expect(isBoldTerminalFontWeight("bold")).toBe(true);
    expect(isBoldTerminalFontWeight(600)).toBe(true);
    expect(isBoldTerminalFontWeight(500)).toBe(false);
    expect(isBoldTerminalFontWeight("normal")).toBe(false);
    expect(isBoldTerminalFontWeight(undefined)).toBe(false);
  });

  it("carries the weight pair through resolveTerminal", () => {
    expect(resolveTerminal("dark", { fontWeight: "bold" })).toMatchObject({
      fontWeight: 700,
      fontWeightBold: 900,
    });
    expect(resolveTerminal("dark", null)).toMatchObject({ fontWeight: 300, fontWeightBold: 700 });
  });
});
