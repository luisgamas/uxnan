/**
 * The one rule every formatter here must uphold: an unknown value renders as a
 * dash, never as a zero. A "0 B" where the collector reported nothing would
 * quietly turn honesty into a lie on every surface at once.
 */

import { describe, expect, it } from "vitest";

import { formatAge, formatBytes, formatCpu, formatRate, UNKNOWN } from "./format";

describe("formatBytes", () => {
  it("renders unknown as a dash, not zero", () => {
    expect(formatBytes(null)).toBe(UNKNOWN);
    expect(formatBytes(undefined)).toBe(UNKNOWN);
    expect(formatBytes(Number.NaN)).toBe(UNKNOWN);
    expect(formatBytes(-1)).toBe(UNKNOWN);
  });

  it("renders a real zero as 0 B (measured, distinct from unknown)", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("scales through the units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(850 * 1024 * 1024)).toBe("850 MB");
    expect(formatBytes(1.4 * 1024 * 1024 * 1024)).toBe("1.4 GB");
  });

  it("drops the decimal once it stops carrying information", () => {
    expect(formatBytes(812 * 1024 * 1024)).toBe("812 MB");
    expect(formatBytes(99.4 * 1024)).toBe("99.4 KB");
  });
});

describe("formatCpu", () => {
  it("renders unknown as a dash and a measured idle as 0%", () => {
    expect(formatCpu(null)).toBe(UNKNOWN);
    expect(formatCpu(undefined)).toBe(UNKNOWN);
    expect(formatCpu(0)).toBe("0%");
  });

  it("keeps one decimal below 10% and rounds above", () => {
    expect(formatCpu(3.44)).toBe("3.4%");
    expect(formatCpu(42.6)).toBe("43%");
  });

  it("clamps runaway values to 100%", () => {
    expect(formatCpu(250)).toBe("100%");
  });
});

describe("formatRate", () => {
  it("appends /s to a known rate and stays a dash otherwise", () => {
    expect(formatRate(2048)).toBe("2 KB/s");
    expect(formatRate(null)).toBe(UNKNOWN);
  });
});

describe("formatAge", () => {
  it("scales seconds → minutes → hours", () => {
    expect(formatAge(12_000)).toBe("12s");
    expect(formatAge(3 * 60_000)).toBe("3m");
    expect(formatAge(65 * 60_000)).toBe("1h 05m");
  });

  it("rejects nonsense", () => {
    expect(formatAge(-5)).toBe(UNKNOWN);
  });
});
