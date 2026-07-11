import { describe, expect, it } from "vitest";
import { normalizeImportedThemes, normalizeImportedTerminalThemes } from "./theme";

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
