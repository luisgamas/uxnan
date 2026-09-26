import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

describe("relativeTime", () => {
  it("picks the coarsest unit that fits", () => {
    expect(relativeTime(NOW - 5 * 60_000, "en", NOW)).toBe("5 minutes ago");
    expect(relativeTime(NOW - 3 * 3_600_000, "en", NOW)).toBe("3 hours ago");
    expect(relativeTime(NOW - 2 * 86_400_000, "en", NOW)).toBe("2 days ago");
    expect(relativeTime(NOW - 400 * 86_400_000, "en", NOW)).toBe("last year");
  });

  it("speaks the app's language", () => {
    expect(relativeTime(NOW - 86_400_000, "es", NOW)).toBe("ayer");
    expect(relativeTime(NOW, "en", NOW)).toBe("this minute");
  });
});
