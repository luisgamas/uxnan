import { describe, expect, it } from "vitest";

import {
  cpuPercentOfCore,
  cpuPercentOfMachine,
  max,
  mean,
  percentile,
  relativeDelta,
  round,
  slopePerHour,
  summarize,
} from "./stats.mjs";

describe("percentile", () => {
  it("interpolates between neighbours (R-7)", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBe(48);
  });

  it("handles the degenerate sizes", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.95)).toBe(7);
  });

  it("ignores values that are not finite numbers", () => {
    expect(percentile([1, null, 3, NaN, undefined, 5], 0.5)).toBe(3);
  });

  it("clamps p to [0, 1]", () => {
    expect(percentile([1, 2, 3], 2)).toBe(3);
    expect(percentile([1, 2, 3], -1)).toBe(1);
  });
});

describe("mean / max", () => {
  it("returns null rather than 0 for nothing measured", () => {
    expect(mean([])).toBeNull();
    expect(max([])).toBeNull();
  });

  it("averages only the finite values", () => {
    expect(mean([2, 4, null])).toBe(3);
  });
});

describe("slopePerHour", () => {
  it("reports growth per hour from millisecond timestamps", () => {
    // +1 MB every 10 minutes = 6 MB/h.
    const points = [0, 1, 2, 3].map((i) => ({ x: i * 600_000, y: 100 + i }));
    expect(slopePerHour(points)).toBeCloseTo(6, 6);
  });

  it("is zero for a flat series and null when there is nothing to fit", () => {
    expect(slopePerHour([{ x: 0, y: 5 }, { x: 60_000, y: 5 }])).toBe(0);
    expect(slopePerHour([{ x: 0, y: 5 }])).toBeNull();
    expect(slopePerHour([{ x: 10, y: 1 }, { x: 10, y: 2 }])).toBeNull();
  });

  it("detects a decline as a negative slope", () => {
    const points = [0, 1, 2].map((i) => ({ x: i * 3_600_000, y: 200 - 10 * i }));
    expect(slopePerHour(points)).toBeCloseTo(-10, 6);
  });
});

describe("cpuPercentOfCore", () => {
  it("turns a cumulative delta into a rate", () => {
    // 500 ms of CPU in a 1 s window = half a core.
    expect(cpuPercentOfCore(1000, 1500, 1000)).toBe(50);
  });

  it("clamps a negative delta (a process left the tree) to zero", () => {
    expect(cpuPercentOfCore(2000, 1500, 1000)).toBe(0);
  });

  it("refuses to divide by a non-positive window", () => {
    expect(cpuPercentOfCore(0, 100, 0)).toBeNull();
    expect(cpuPercentOfCore(0, 100, -5)).toBeNull();
  });

  it("normalises against the machine only when asked", () => {
    expect(cpuPercentOfMachine(400, 8)).toBe(50);
    expect(cpuPercentOfMachine(null, 8)).toBeNull();
    expect(cpuPercentOfMachine(400, 0)).toBeNull();
  });
});

describe("relativeDelta", () => {
  it("expresses change as a fraction of the baseline", () => {
    expect(relativeDelta(200, 230)).toBeCloseTo(0.15, 10);
    expect(relativeDelta(200, 170)).toBeCloseTo(-0.15, 10);
  });

  it("refuses a percentage against zero", () => {
    expect(relativeDelta(0, 10)).toBeNull();
  });
});

describe("round / summarize", () => {
  it("passes null through untouched", () => {
    expect(round(null)).toBeNull();
    expect(round(1.23456, 2)).toBe(1.23);
  });

  it("summarises a series into the published shape", () => {
    expect(summarize([1, 2, 3, 4, 5])).toEqual({ n: 5, p50: 3, p95: 4.8, mean: 3, min: 1, max: 5 });
  });

  it("returns null for a series with nothing measurable", () => {
    expect(summarize([null, undefined, NaN])).toBeNull();
  });
});
