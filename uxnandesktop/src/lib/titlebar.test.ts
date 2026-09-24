import { describe, expect, it } from "vitest";
import { regionEdges, titlebarInsets } from "./titlebar";

describe("titlebarInsets", () => {
  it("clears the traffic lights only on macOS", () => {
    expect(titlebarInsets({ left: true, right: false }, true)).toBe("pl-20");
    expect(titlebarInsets({ left: true, right: false }, false)).toBe("");
  });

  it("clears the top-right controls — wider where the app draws the window buttons", () => {
    expect(titlebarInsets({ left: false, right: true }, true)).toBe("pr-10");
    expect(titlebarInsets({ left: false, right: true }, false)).toBe("pr-40");
  });

  it("clears both corners for a bar spanning the window, and nothing for an inner one", () => {
    expect(titlebarInsets({ left: true, right: true }, true)).toBe("pl-20 pr-10");
    expect(titlebarInsets({ left: false, right: false }, true)).toBe("");
  });
});

describe("regionEdges", () => {
  it("finds the corners a region of the center area reaches", () => {
    expect(regionEdges({ x: 0, y: 0, w: 100 })).toEqual({ left: true, right: true });
    // A vertical split: left half, right half.
    expect(regionEdges({ x: 0, y: 0, w: 50 })).toEqual({ left: true, right: false });
    expect(regionEdges({ x: 50, y: 0, w: 50 })).toEqual({ left: false, right: true });
    // A horizontal split: only the top region touches the top edge.
    expect(regionEdges({ x: 0, y: 50, w: 100 })).toEqual({ left: false, right: false });
  });

  it("tolerates the rounding of computed split ratios", () => {
    expect(regionEdges({ x: 33.333333, y: 0, w: 66.666667 })).toEqual({ left: false, right: true });
  });
});
