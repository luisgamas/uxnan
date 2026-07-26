import { describe, expect, it } from "vitest";
import {
  intervalMs,
  nextOccurrence,
  nextOccurrences,
  sameSchedule,
  startBoundary,
  toLocalIso,
  validateSchedule,
} from "./schedule";
import type { Schedule } from "./types";

/** A fixed local moment: Saturday 2026-07-25, 10:30. Every assertion below is
 *  relative to it, so the tests never depend on the wall clock. */
const NOW = new Date(2026, 6, 25, 10, 30, 0, 0);

describe("interval schedules", () => {
  it("converts each unit to milliseconds", () => {
    expect(intervalMs({ kind: "every", n: 15, unit: "minutes", startsAt: 0 })).toBe(900_000);
    expect(intervalMs({ kind: "every", n: 2, unit: "hours", startsAt: 0 })).toBe(7_200_000);
    expect(intervalMs({ kind: "every", n: 1, unit: "days", startsAt: 0 })).toBe(86_400_000);
    expect(intervalMs({ kind: "every", n: 1, unit: "weeks", startsAt: 0 })).toBe(604_800_000);
    // A clock preset has no plain interval.
    expect(intervalMs({ kind: "dailyAt", hour: 9, minute: 0 })).toBeNull();
  });

  it("keeps the cadence of an anchor in the past instead of restarting it", () => {
    // Anchored two hours ago on a 15-minute cadence: the next run must land on
    // the anchor's grid, not 15 minutes from "now".
    const anchor = new Date(NOW.getTime() - 2 * 3_600_000).getTime();
    const schedule: Schedule = { kind: "every", n: 15, unit: "minutes", startsAt: anchor };
    const [first, second] = nextOccurrences(schedule, NOW, 2);
    expect((first.getTime() - anchor) % 900_000).toBe(0);
    expect(first.getTime()).toBeGreaterThan(NOW.getTime());
    expect(first.getTime() - NOW.getTime()).toBeLessThanOrEqual(900_000);
    expect(second.getTime() - first.getTime()).toBe(900_000);
  });

  it("anchors on now when the schedule has no start", () => {
    const schedule: Schedule = { kind: "every", n: 30, unit: "minutes", startsAt: 0 };
    const [first] = nextOccurrences(schedule, NOW, 1);
    expect(first.getTime()).toBe(NOW.getTime() + 1_800_000);
  });

  it("starts at a future anchor rather than before it", () => {
    const anchor = new Date(NOW.getTime() + 3_600_000).getTime();
    const schedule: Schedule = { kind: "every", n: 15, unit: "minutes", startsAt: anchor };
    expect(nextOccurrence(schedule, NOW)?.getTime()).toBe(anchor);
  });
});

describe("clock-time presets", () => {
  it("takes today when the time is still ahead, tomorrow once it has passed", () => {
    const later: Schedule = { kind: "dailyAt", hour: 18, minute: 0 };
    expect(nextOccurrence(later, NOW)).toEqual(new Date(2026, 6, 25, 18, 0));

    const earlier: Schedule = { kind: "dailyAt", hour: 9, minute: 0 };
    expect(nextOccurrence(earlier, NOW)).toEqual(new Date(2026, 6, 26, 9, 0));
  });

  it("never returns the current moment itself", () => {
    // Exactly "now" has already fired; the next one is tomorrow.
    const schedule: Schedule = { kind: "dailyAt", hour: 10, minute: 30 };
    expect(nextOccurrence(schedule, NOW)).toEqual(new Date(2026, 6, 26, 10, 30));
  });

  it("skips the weekend for a weekdays schedule", () => {
    // NOW is a Saturday, so the next weekday run is Monday the 27th.
    const schedule: Schedule = { kind: "weekdaysAt", hour: 7, minute: 0 };
    const runs = nextOccurrences(schedule, NOW, 6);
    expect(runs[0]).toEqual(new Date(2026, 6, 27, 7, 0));
    expect(runs.map((d) => d.getDay())).toEqual([1, 2, 3, 4, 5, 1]);
  });

  it("walks week by week for a weekly schedule", () => {
    // Wednesday = 3.
    const schedule: Schedule = { kind: "weeklyAt", day: 3, hour: 18, minute: 30 };
    const runs = nextOccurrences(schedule, NOW, 3);
    expect(runs[0]).toEqual(new Date(2026, 6, 29, 18, 30));
    expect(runs.every((d) => d.getDay() === 3)).toBe(true);
    expect(runs[1].getTime() - runs[0].getTime()).toBe(7 * 86_400_000);
  });

  it("crosses a month boundary without help", () => {
    const endOfMonth = new Date(2026, 6, 31, 23, 0);
    const schedule: Schedule = { kind: "dailyAt", hour: 9, minute: 0 };
    expect(nextOccurrence(schedule, endOfMonth)).toEqual(new Date(2026, 7, 1, 9, 0));
  });
});

describe("start boundary", () => {
  it("is local wall-clock text with no timezone suffix", () => {
    // A task must fire at the user's local time, so a UTC/ISO string with a Z
    // would schedule it at the wrong hour for most of the world.
    const iso = toLocalIso(new Date(2026, 0, 5, 9, 5, 0));
    expect(iso).toBe("2026-01-05T09:05:00");
    expect(iso).not.toContain("Z");
    expect(iso).not.toContain("+");
  });

  it("is the schedule's next occurrence", () => {
    const schedule: Schedule = { kind: "dailyAt", hour: 18, minute: 0 };
    expect(startBoundary(schedule, NOW)).toBe("2026-07-25T18:00:00");
  });

  it("still yields a timestamp when a schedule produces nothing", () => {
    // Saving must never fail for want of a boundary.
    const broken = { kind: "weeklyAt", day: 99, hour: 9, minute: 0 } as unknown as Schedule;
    expect(startBoundary(broken, NOW)).toBe(toLocalIso(NOW));
  });
});

describe("validation", () => {
  it("mirrors the backend's floor of one minute", () => {
    expect(validateSchedule({ kind: "every", n: 1, unit: "minutes", startsAt: 0 })).toEqual([]);
    expect(validateSchedule({ kind: "every", n: 0, unit: "hours", startsAt: 0 })).toContain(
      "interval",
    );
  });

  it("bounds the clock fields", () => {
    expect(validateSchedule({ kind: "dailyAt", hour: 24, minute: 0 })).toContain("hour");
    expect(validateSchedule({ kind: "dailyAt", hour: 9, minute: 60 })).toContain("minute");
    expect(validateSchedule({ kind: "weeklyAt", day: 7, hour: 9, minute: 0 })).toContain("weekday");
    expect(validateSchedule({ kind: "weeklyAt", day: 6, hour: 23, minute: 59 })).toEqual([]);
  });
});

describe("comparison", () => {
  it("detects a changed recurrence so the OS task can be re-registered", () => {
    const a: Schedule = { kind: "dailyAt", hour: 9, minute: 0 };
    expect(sameSchedule(a, { kind: "dailyAt", hour: 9, minute: 0 })).toBe(true);
    expect(sameSchedule(a, { kind: "dailyAt", hour: 10, minute: 0 })).toBe(false);
    expect(sameSchedule(a, { kind: "weekdaysAt", hour: 9, minute: 0 })).toBe(false);
    expect(
      sameSchedule(
        { kind: "every", n: 15, unit: "minutes", startsAt: 1 },
        { kind: "every", n: 15, unit: "minutes", startsAt: 2 },
      ),
    ).toBe(false);
  });
});
