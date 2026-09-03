import { describe, expect, it } from "vitest";
import { clampPanelWidth } from "./panelWidth";

describe("clampPanelWidth", () => {
  it("holds the width inside its bounds", () => {
    expect(clampPanelWidth(150, 200, 480)).toBe(200);
    expect(clampPanelWidth(900, 200, 480)).toBe(480);
    expect(clampPanelWidth(320, 200, 480)).toBe(320);
  });

  it("returns a whole number of pixels, because the persisted field is u32", () => {
    // The exact value the backend rejected on macOS: a subpixel `clientX`
    // reached `update_settings` and serde failed the whole AppSettings payload
    // with "invalid type: floating point `312.57421875`, expected u32".
    const dragged = clampPanelWidth(312.57421875, 300, 560);
    expect(dragged).toBe(313);
    expect(Number.isInteger(dragged)).toBe(true);
  });

  it("rounds a width that a bound itself made fractional", () => {
    // The right panel's floor is a measured tab-strip width, so the clamp can
    // return the bound rather than the dragged value — that has to be whole too.
    expect(clampPanelWidth(10, 300.4, 560)).toBe(300);
    expect(clampPanelWidth(9999, 300, 559.6)).toBe(560);
  });
});
