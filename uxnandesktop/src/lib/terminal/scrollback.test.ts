import { describe, expect, it } from "vitest";
import {
  clampScrollback,
  DEFAULT_TERMINAL_SCROLLBACK,
  MIN_TERMINAL_SCROLLBACK,
  MAX_TERMINAL_SCROLLBACK,
} from "./scrollback";

describe("clampScrollback", () => {
  it("falls back to the default for unset / non-finite values", () => {
    expect(clampScrollback(undefined)).toBe(DEFAULT_TERMINAL_SCROLLBACK);
    expect(clampScrollback(null)).toBe(DEFAULT_TERMINAL_SCROLLBACK);
    expect(clampScrollback(Number.NaN)).toBe(DEFAULT_TERMINAL_SCROLLBACK);
    expect(clampScrollback(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TERMINAL_SCROLLBACK);
  });

  it("clamps below/above the supported range", () => {
    expect(clampScrollback(0)).toBe(MIN_TERMINAL_SCROLLBACK);
    expect(clampScrollback(10)).toBe(MIN_TERMINAL_SCROLLBACK);
    expect(clampScrollback(9_999_999)).toBe(MAX_TERMINAL_SCROLLBACK);
  });

  it("keeps in-range values and rounds fractionals", () => {
    expect(clampScrollback(20_000)).toBe(20_000);
    expect(clampScrollback(12_345.7)).toBe(12_346);
  });
});
