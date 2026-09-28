import { describe, expect, it } from "vitest";
import type { UsageWindow } from "./types";
import {
  USAGE_CATALOG,
  activatableUsageProviders,
  resolveStatusBarWindows,
  usageProvider,
  usageProviderForAgent,
} from "./usageCatalog";

describe("activatableUsageProviders", () => {
  it("returns the complete catalog", () => {
    expect(activatableUsageProviders()).toEqual(USAGE_CATALOG);
  });

  it("keeps every non-deprecated provider offered", () => {
    expect(activatableUsageProviders().map((p) => p.id)).toEqual([
      "codex",
      "claude",
      "copilot",
      "grok",
    ]);
  });
});

describe("usageProvider", () => {
  it("returns undefined for an unknown id", () => {
    // @ts-expect-error — guarding the runtime path a stale persisted config hits.
    expect(usageProvider("nope")).toBeUndefined();
  });

  it("maps a bridge agent to the plan it spends", () => {
    expect(usageProviderForAgent("claude-code")?.id).toBe("claude");
    expect(usageProviderForAgent("codex")?.id).toBe("codex");
    expect(usageProviderForAgent("grok")?.id).toBe("grok");
    expect(usageProviderForAgent("opencode")).toBeUndefined();
    expect(usageProviderForAgent(undefined)).toBeUndefined();
  });
});

describe("resolveStatusBarWindows", () => {
  const session: UsageWindow = { id: "session5h", label: "Session (5h)", usedPercent: 40, windowMinutes: 300 };
  const weekly: UsageWindow = { id: "weekly", label: "Weekly", usedPercent: 12, windowMinutes: 10_080 };
  const monthly: UsageWindow = { id: "monthly", label: "Monthly", usedPercent: 7, windowMinutes: 43_200 };

  it("falls back to the first window when the saved ids name none of today's", () => {
    // The old native reader's ids, against a Codex account that now reports a
    // single window named by its length.
    expect(resolveStatusBarWindows(["primary_window", "secondary_window"], [monthly])).toEqual([monthly]);
  });

  it("reads `*` as the first window", () => {
    expect(resolveStatusBarWindows(["*"], [session, weekly])).toEqual([session]);
    expect(resolveStatusBarWindows(["*", "weekly"], [session, weekly])).toEqual([session, weekly]);
  });

  it("keeps only the matches, in snapshot order, when some ids still match", () => {
    expect(resolveStatusBarWindows(["weekly", "primary_window"], [session, weekly])).toEqual([weekly]);
    expect(resolveStatusBarWindows(["weekly", "session5h"], [session, weekly])).toEqual([session, weekly]);
  });

  it("surfaces nothing without windows, or when nothing was picked", () => {
    expect(resolveStatusBarWindows(["*"], [])).toEqual([]);
    expect(resolveStatusBarWindows(["primary_window"], undefined)).toEqual([]);
    expect(resolveStatusBarWindows([], [session, weekly])).toEqual([]);
  });
});
