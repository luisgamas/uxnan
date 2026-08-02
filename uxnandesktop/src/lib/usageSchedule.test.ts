import { describe, expect, it } from "vitest";
import type { ProviderUsage, UsageProviderConfig } from "./types";
import { configuredUsageMinutes, usageSnapshotIsStale } from "./usageSchedule";

const config = (refreshMinutes?: number | null): UsageProviderConfig => ({
  provider: "codex",
  refreshMinutes,
  statusBar: { show: true, windows: ["*"] },
});

const snapshot = (updatedAt: number): ProviderUsage => ({
  provider: "codex",
  status: "ok",
  windows: [],
  updatedAt,
});

describe("configuredUsageMinutes", () => {
  it("uses a provider override when set and otherwise follows the global value", () => {
    expect(configuredUsageMinutes(config(1), 15)).toBe(1);
    expect(configuredUsageMinutes(config(null), 15)).toBe(15);
    expect(configuredUsageMinutes(config(undefined), 5)).toBe(5);
  });
});

describe("usageSnapshotIsStale", () => {
  it("always fetches an absent initial snapshot, even in manual mode", () => {
    expect(usageSnapshotIsStale(undefined, 0, 10_000)).toBe(true);
  });

  it("does not auto-refresh an existing manual-only snapshot", () => {
    expect(usageSnapshotIsStale(snapshot(1), 0, 1_000_000)).toBe(false);
  });

  it("catches up after the configured interval", () => {
    expect(usageSnapshotIsStale(snapshot(1_000), 5, 300_999)).toBe(false);
    expect(usageSnapshotIsStale(snapshot(1_000), 5, 301_000)).toBe(true);
  });
});
