import { describe, expect, it } from "vitest";
import { pressingWindow, windowPace } from "./usagePace";
import type { ProviderUsage, UsageWindow } from "$lib/types";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const HOUR = 3_600_000;
const w = (used: number, leftMs: number, minutes = 300, id = "w"): UsageWindow => ({
  id,
  label: id,
  usedPercent: used,
  windowMinutes: minutes,
  resetsAt: NOW + leftMs,
});

describe("usage pace", () => {
  it("says when the pace hits the limit before the reset", () => {
    // 3 of 5 hours passed, 72% used: 28% more in 70 minutes, before the reset in 2 h.
    const pace = windowPace(w(72, 2 * HOUR), NOW)!;
    expect(pace.elapsed).toBeCloseTo(0.6);
    expect(pace.runsOutInMs).toBe(70 * 60_000);
    expect(windowPace(w(20, 2 * HOUR), NOW)?.runsOutInMs).toBeUndefined();
    expect(windowPace(w(100, HOUR), NOW)?.runsOutInMs).toBe(0);
  });

  it("stays quiet without a length, a reset, or time enough to judge", () => {
    expect(windowPace({ id: "x", label: "x", usedPercent: 50 }, NOW)).toBeUndefined();
    expect(windowPace(w(1, 299 * 60_000), NOW)).toBeUndefined();
  });

  it("picks the window that runs out first, else the fullest", () => {
    const usage = (windows: UsageWindow[]): ProviderUsage =>
      ({ provider: "claude", status: "ok", windows, updatedAt: NOW }) as ProviderUsage;
    const weekly = w(40, 3 * 24 * HOUR, 10_080, "weekly");
    const session = w(72, 2 * HOUR, 300, "session");
    expect(pressingWindow(usage([weekly, session]), NOW)?.window.id).toBe("session");
    const calm = w(10, 2 * HOUR, 300, "session");
    expect(pressingWindow(usage([calm, weekly]), NOW)?.window.id).toBe("weekly");
    expect(pressingWindow(usage([]), NOW)).toBeUndefined();
    expect(pressingWindow(undefined, NOW)).toBeUndefined();
  });


});
