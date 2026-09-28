import { describe, expect, it } from "vitest";
import { columnOutline, MIN_SEGMENT, SEGMENT_GAP, stackColumn } from "./spendColumn";

const heights = (layout: ReturnType<typeof stackColumn>) =>
  layout.segments.map((s) => +(s.top - s.bottom).toFixed(3));

describe("stackColumn", () => {
  it("keeps the day's height and splits it by share, with a gap between agents", () => {
    const layout = stackColumn([30, 10], 100);
    expect(layout.height).toBe(100);
    expect(heights(layout)).toEqual([73.5, 24.5]);
    expect(layout.segments[1]!.bottom - layout.segments[0]!.top).toBe(SEGMENT_GAP);
    expect(layout.segments.at(-1)!.top).toBeCloseTo(100);
  });

  it("never lets a small share vanish: it takes the least height, from the largest", () => {
    const layout = stackColumn([1000, 1, 0, 1], 100);
    expect(layout.segments.map((s) => s.index)).toEqual([0, 1, 3]);
    const [big, small1, small2] = heights(layout);
    expect(small1).toBe(MIN_SEGMENT);
    expect(small2).toBe(MIN_SEGMENT);
    expect(big! + small1! + small2! + 2 * SEGMENT_GAP).toBeCloseTo(100);
  });

  it("grows a column too short to hold every agent it has", () => {
    const layout = stackColumn([5, 5, 5], 1);
    expect(layout.height).toBe(3 * MIN_SEGMENT + 2 * SEGMENT_GAP);
    expect(heights(layout)).toEqual([MIN_SEGMENT, MIN_SEGMENT, MIN_SEGMENT]);
  });

  it("draws nothing for a day with no spend", () => {
    expect(stackColumn([0, 0], 50)).toEqual({ height: 0, segments: [] });
  });
});

describe("columnOutline", () => {
  it("rounds the top of the whole column, never more than half its width or its height", () => {
    expect(columnOutline(0, 100, 10, 50)).toBe("M0,100 V54 Q0,50 4,50 H6 Q10,50 10,54 V100 Z");
    expect(columnOutline(0, 100, 4, 50)).toContain("Q0,50 2,50");
    expect(columnOutline(0, 100, 10, 1)).toContain("V100 Q0,99 1,99");
  });
});
