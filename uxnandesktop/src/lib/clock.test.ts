import { describe, expect, it } from "vitest";
import { formatClock, formatCountdown, formatDateClock, formatWeekdayDateClock } from "./clock";

// Every clock time the app shows is on the 24-hour clock, in every language:
// the same moment read `2:30 PM` in the chat and `14:30` in the automations.
describe("formatCountdown", () => {
  it("writes what is left as m:ss, never below zero", () => {
    expect(formatCountdown(535)).toBe("8:55");
    expect(formatCountdown(7)).toBe("0:07");
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(59.9)).toBe("0:59");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("clock", () => {
  const afternoon = new Date(2026, 8, 12, 14, 30);
  const pastMidnight = new Date(2026, 8, 12, 0, 25);

  it("writes the 24-hour clock with two-digit hours", () => {
    expect(formatClock(afternoon)).toBe("14:30");
    expect(formatClock(pastMidnight)).toBe("00:25");
  });

  it("keeps the 24-hour clock whatever the language of the date", () => {
    for (const locale of ["en-US", "es-MX"]) {
      expect(formatDateClock(afternoon, locale)).toMatch(/, 14:30$/);
      expect(formatDateClock(afternoon, locale, { withYear: true })).toMatch(/2026, 14:30$/);
      expect(formatWeekdayDateClock(pastMidnight, locale)).toMatch(/, 00:25$/);
    }
    expect(formatDateClock(afternoon, "en-US")).toBe("Sep 12, 14:30");
  });
});
