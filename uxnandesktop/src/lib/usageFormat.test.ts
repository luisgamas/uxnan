import { describe, expect, it } from "vitest";
import { formatCredit, formatReset, meterFill, statusMeta } from "./usageFormat";

describe("formatReset", () => {
  it("returns null for unknown or past resets", () => {
    expect(formatReset(undefined)).toBeNull();
    expect(formatReset(0)).toBeNull();
    expect(formatReset(Date.now() - 60_000)).toBeNull();
  });

  it("formats a future reset as compact units", () => {
    // +30s keeps each value off the exact minute boundary so the floor in
    // formatReset can't tip down while a few ms elapse during the assertion.
    const now = Date.now() + 30_000;
    expect(formatReset(now + 5 * 60_000)).toBe("5m");
    expect(formatReset(now + (2 * 60 + 30) * 60_000)).toBe("2h 30m");
    expect(formatReset(now + 26 * 60 * 60_000)).toBe("1d 2h");
  });
});

describe("formatCredit", () => {
  it("renders currency and credit units", () => {
    expect(formatCredit(4.2, "USD")).toBe("$4.20");
    expect(formatCredit(4.2, "EUR")).toBe("€4.20");
    expect(formatCredit(120, "credits")).toBe("120 credits");
    expect(formatCredit(4.2, "GBP")).toBe("4.20 GBP");
  });
});

describe("meterFill", () => {
  it("escalates color with usage", () => {
    expect(meterFill(10)).toContain("emerald");
    expect(meterFill(75)).toContain("amber");
    expect(meterFill(95)).toContain("destructive");
  });
});

describe("statusMeta", () => {
  it("maps every status to a dot + label key", () => {
    for (const s of ["ok", "authRequired", "notInstalled", "error"] as const) {
      const m = statusMeta(s);
      expect(m.dot).toBeTruthy();
      expect(m.labelKey.startsWith("providers.status")).toBe(true);
    }
  });
});
