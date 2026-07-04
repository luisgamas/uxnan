import { describe, it, expect } from "vitest";
import {
  BUILTIN_ICON_NAMES,
  BUILTIN_COLORS,
  buildBuiltinIcon,
  isBuiltinIcon,
  parseBuiltinKey,
} from "./iconCatalog";

describe("iconCatalog", () => {
  it("builds builtin keys, omitting the default color", () => {
    expect(buildBuiltinIcon("rocket")).toBe("builtin:rocket");
    expect(buildBuiltinIcon("rocket", null)).toBe("builtin:rocket");
    expect(buildBuiltinIcon("rocket", "default")).toBe("builtin:rocket");
    expect(buildBuiltinIcon("rocket", "#f59e0b")).toBe("builtin:rocket~#f59e0b");
  });

  it("detects builtin values vs custom images / empty", () => {
    expect(isBuiltinIcon("builtin:star")).toBe(true);
    expect(isBuiltinIcon("data:image/png;base64,AAAA")).toBe(false);
    expect(isBuiltinIcon("https://example.com/a.png")).toBe(false);
    expect(isBuiltinIcon(null)).toBe(false);
    expect(isBuiltinIcon(undefined)).toBe(false);
    expect(isBuiltinIcon("")).toBe(false);
  });

  it("round-trips a built-in name + custom hex color through parse", () => {
    const r = parseBuiltinKey("builtin:flame~#0ea5e9");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("flame");
    expect(r!.color).toBe("#0ea5e9");
  });

  it("resolves a legacy named color key to its hex (back-compat)", () => {
    expect(parseBuiltinKey("builtin:flame~amber")!.color).toBe("#f59e0b");
  });

  it("defaults the color to none when unspecified", () => {
    const r = parseBuiltinKey("builtin:rocket");
    expect(r!.color).toBeNull();
  });

  it("returns null for non-builtin values", () => {
    expect(parseBuiltinKey(null)).toBeNull();
    expect(parseBuiltinKey("data:image/png;base64,AAAA")).toBeNull();
    expect(parseBuiltinKey("https://example.com/a.png")).toBeNull();
  });

  it("parses every catalog name round-trip, with unique names + color keys", () => {
    for (const name of BUILTIN_ICON_NAMES) {
      expect(parseBuiltinKey(buildBuiltinIcon(name))?.name).toBe(name);
    }
    expect(new Set(BUILTIN_ICON_NAMES).size).toBe(BUILTIN_ICON_NAMES.length);
    const colorKeys = BUILTIN_COLORS.map((c) => c.key);
    expect(new Set(colorKeys).size).toBe(colorKeys.length);
  });
});
