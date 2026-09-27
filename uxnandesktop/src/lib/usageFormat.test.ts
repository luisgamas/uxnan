import { describe, expect, it } from "vitest";
import {
  accountTypeLabelKey,
  formatCredit,
  formatReset,
  formatResetAbsolute,
  meterFill,
  statusMeta,
} from "./usageFormat";
import type { AccountType } from "./types";

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

describe("formatResetAbsolute", () => {
  it("returns null for unknown or past resets", () => {
    expect(formatResetAbsolute(undefined)).toBeNull();
    expect(formatResetAbsolute(0)).toBeNull();
    expect(formatResetAbsolute(Date.now() - 60_000)).toBeNull();
  });

  it("returns a clock time for a same-day reset (no date prefix)", () => {
    const inTwoHours = formatResetAbsolute(Date.now() + 2 * 60 * 60_000);
    expect(inTwoHours).toBeTruthy();
    // Same day → time only, so no comma (the month/day form uses ", ").
    expect(inTwoHours).not.toContain(",");
  });

  it("prefixes a date for a far-future reset", () => {
    const inTwoWeeks = formatResetAbsolute(Date.now() + 14 * 86_400_000);
    expect(inTwoWeeks).toBeTruthy();
    expect(inTwoWeeks).toContain(",");
  });
});

describe("accountTypeLabelKey", () => {
  it("maps every account type to a providers.account* key", () => {
    for (const t of [
      "subscription",
      "payAsYouGo",
      "free",
      "team",
      "enterprise",
    ] as AccountType[]) {
      expect(accountTypeLabelKey(t).startsWith("providers.account")).toBe(true);
    }
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
