import { describe, expect, it } from "vitest";
import { formatClock, formatDateClock, formatWeekdayDateClock } from "./clock";

// Every clock time the app shows is on the 24-hour clock, in every language:
// the same moment read `2:30 PM` in the chat and `14:30` in the automations.
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
