import { describe, expect, it } from "vitest";
import {
  accountTypeLabelKey,
  formatMoney,
  formatReset,
  formatResetAbsolute,
  formatTokenCount,
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

describe("formatMoney", () => {
  it("writes money the way its currency is, in every UI language", () => {
    expect(formatMoney(4.2, "USD")).toBe("$4.20");
    expect(formatMoney(4.2)).toBe("$4.20");
    expect(formatMoney(4.2, "EUR")).toBe("€4.20");
    expect(formatMoney(4.2, "GBP")).toBe("£4.20");
    expect(formatMoney(120, "credits")).toBe("120 credits");
  });

  it("keeps cents under 100, whole units from 100, and a trace as <$0.01", () => {
    expect(formatMoney(3.5)).toBe("$3.50");
    expect(formatMoney(99.99)).toBe("$99.99");
    expect(formatMoney(9558.6)).toBe("$9,559");
    expect(formatMoney(0.004)).toBe("<$0.01");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("falls back to the number and the unit for a code that isn't a currency", () => {
    expect(formatMoney(4.2, "tokens")).toBe("4.20 TOKENS");
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
  it("maps every status to a StatusDot tone + label key", () => {
    const tones = {
      ok: "ok",
      authRequired: "warn",
      notInstalled: "off",
      error: "error",
    } as const;
    for (const [s, tone] of Object.entries(tones) as [keyof typeof tones, string][]) {
      const m = statusMeta(s);
      expect(m.tone).toBe(tone);
      expect(m.labelKey.startsWith("providers.status")).toBe(true);
    }
  });
});

describe("formatTokenCount", () => {
  it("reads a token count compactly, in the given locale", () => {
    expect(formatTokenCount(950, "en")).toBe("950");
    expect(formatTokenCount(12_400, "en")).toBe("12.4K");
    expect(formatTokenCount(1_250_000, "en")).toBe("1.3M");
  });
});
