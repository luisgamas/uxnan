/**
 * Resource-mode policy engine. The two invariants that matter most:
 * `balanced` must equal the pre-mode constants (the default changes nothing),
 * and normalization must leave no residue — corrupt or hostile persisted
 * values always collapse to a clean document instead of reaching a consumer.
 */

import { describe, expect, it } from "vitest";

import {
  effectiveGithubPollSeconds,
  effectiveOrchestrationConcurrency,
  effectiveUsageRefreshMinutes,
  freshnessRelaxations,
  HEADROOM_CPU_LIMIT_PERCENT,
  HEADROOM_MAX_AGE_MS,
  LIMITS,
  normalizeResourceMode,
  orchestrationHeadroom,
  OVERRIDABLE_KEYS,
  PRESETS,
  RESOURCE_MODE_SCHEMA_VERSION,
  resolveFromSettings,
  resolvePolicy,
  type ResolvedResourcePolicy,
} from "./policy";
import type { ResourceSummary } from "$lib/types";

const policyFor = (raw: unknown): ResolvedResourcePolicy => resolveFromSettings(raw);

describe("presets", () => {
  it("balanced mirrors the pre-mode constants exactly", () => {
    // These literals are the constants the consumers shipped with before the
    // mode existed (SWEEP_MS, the every-tick reconcile, 1x polls,
    // MAX_CONCURRENCY, the monitor's 10-minute buffer). If one of these fails,
    // the default profile changed behavior — which it must never do silently.
    expect(PRESETS.balanced).toEqual({
      gitSweepIntervalMs: 15_000,
      worktreeReconcileIntervalMs: 0,
      githubPollFactor: 1,
      usageRefreshFactor: 1,
      orchestrationConcurrency: 4,
      orchestrationExtendedConcurrency: null,
      resourceHistorySeconds: 600,
      petFlavour: true,
      workspaceAutoSleep: "off",
      autoSleepIdleMinutes: 30,
    });
  });

  it("efficient reduces background work on every governed capability", () => {
    const e = PRESETS.efficient;
    const b = PRESETS.balanced;
    expect(e.gitSweepIntervalMs).toBeGreaterThan(b.gitSweepIntervalMs);
    expect(e.worktreeReconcileIntervalMs).toBeGreaterThan(b.worktreeReconcileIntervalMs);
    expect(e.githubPollFactor).toBeGreaterThan(b.githubPollFactor);
    expect(e.usageRefreshFactor).toBeGreaterThan(b.usageRefreshFactor);
    expect(e.orchestrationConcurrency).toBeLessThan(b.orchestrationConcurrency);
    expect(e.resourceHistorySeconds).toBeLessThan(b.resourceHistorySeconds);
    expect(e.petFlavour).toBe(false);
    expect(e.workspaceAutoSleep).toBe("suggest");
  });

  it("performance is fresher but never aggressive, and only extends concurrency", () => {
    const p = PRESETS.performance;
    const b = PRESETS.balanced;
    expect(p.gitSweepIntervalMs).toBeLessThan(b.gitSweepIntervalMs);
    expect(p.gitSweepIntervalMs).toBeGreaterThanOrEqual(LIMITS.gitSweepIntervalMs.min);
    // The base concurrency stays at balanced; only the headroom-gated ceiling grows.
    expect(p.orchestrationConcurrency).toBe(b.orchestrationConcurrency);
    expect(p.orchestrationExtendedConcurrency).toBeGreaterThan(b.orchestrationConcurrency);
    // Auto-sleep and history stay at the balanced posture.
    expect(p.workspaceAutoSleep).toBe("off");
    expect(p.resourceHistorySeconds).toBe(b.resourceHistorySeconds);
  });

  it("every preset respects the hard limits", () => {
    for (const preset of Object.values(PRESETS)) {
      expect(preset.gitSweepIntervalMs).toBeGreaterThanOrEqual(LIMITS.gitSweepIntervalMs.min);
      expect(preset.gitSweepIntervalMs).toBeLessThanOrEqual(LIMITS.gitSweepIntervalMs.max);
      expect(preset.orchestrationConcurrency).toBeGreaterThanOrEqual(
        LIMITS.orchestrationConcurrency.min,
      );
      expect(preset.orchestrationConcurrency).toBeLessThanOrEqual(
        LIMITS.orchestrationConcurrency.max,
      );
      expect(preset.resourceHistorySeconds).toBeGreaterThanOrEqual(
        LIMITS.resourceHistorySeconds.min,
      );
      expect(preset.resourceHistorySeconds).toBeLessThanOrEqual(LIMITS.resourceHistorySeconds.max);
    }
  });
});

describe("normalizeResourceMode", () => {
  it("defaults to balanced with no overrides for absent settings", () => {
    for (const raw of [undefined, null, "efficient", 42, ["efficient"], true]) {
      expect(normalizeResourceMode(raw)).toEqual({
        profile: "balanced",
        overrides: {},
        autoSleep: false,
        schemaVersion: RESOURCE_MODE_SCHEMA_VERSION,
      });
    }
  });

  it("accepts each known profile and rejects unknown ones", () => {
    expect(normalizeResourceMode({ profile: "efficient" }).profile).toBe("efficient");
    expect(normalizeResourceMode({ profile: "performance" }).profile).toBe("performance");
    expect(normalizeResourceMode({ profile: "turbo" }).profile).toBe("balanced");
    expect(normalizeResourceMode({ profile: 3 }).profile).toBe("balanced");
  });

  it("keeps valid overrides, clamped into the hard limits", () => {
    const mode = normalizeResourceMode({
      profile: "efficient",
      overrides: {
        gitSweepIntervalMs: 1, // below the floor -> clamped up
        orchestrationConcurrency: 99, // above the ceiling -> clamped down
        resourceHistorySeconds: 240.7, // rounded
        petFlavour: true,
        workspaceAutoSleep: "auto",
        autoSleepIdleMinutes: 60,
      },
    });
    expect(mode.overrides).toEqual({
      gitSweepIntervalMs: LIMITS.gitSweepIntervalMs.min,
      orchestrationConcurrency: LIMITS.orchestrationConcurrency.max,
      resourceHistorySeconds: 241,
      petFlavour: true,
      workspaceAutoSleep: "auto",
      autoSleepIdleMinutes: 60,
    });
  });

  it("drops null (= inherit), unknown keys and wrong-typed values without residue", () => {
    const mode = normalizeResourceMode({
      profile: "balanced",
      overrides: {
        gitSweepIntervalMs: null, // explicit inherit
        orchestrationConcurrency: "many", // wrong type
        resourceHistorySeconds: Number.NaN, // not finite
        workspaceAutoSleep: "sometimes", // not a level
        petFlavour: 1, // wrong type
        turboBoost: true, // unknown capability
        githubPollFactor: 0, // a real capability, but not overridable
      },
    });
    expect(mode.overrides).toEqual({});
  });

  it("treats a newer schema version as balanced with no overrides (rollback safety)", () => {
    const mode = normalizeResourceMode({
      profile: "efficient",
      overrides: { orchestrationConcurrency: 2 },
      autoSleep: true,
      schemaVersion: RESOURCE_MODE_SCHEMA_VERSION + 1,
    });
    expect(mode).toEqual({
      profile: "balanced",
      overrides: {},
      autoSleep: false,
      schemaVersion: RESOURCE_MODE_SCHEMA_VERSION,
    });
  });

  it("parses a document without a schema version as v1", () => {
    const mode = normalizeResourceMode({ profile: "efficient", autoSleep: true });
    expect(mode.profile).toBe("efficient");
    expect(mode.autoSleep).toBe(true);
  });

  it("only a literal true enables the auto-sleep flag", () => {
    expect(normalizeResourceMode({ autoSleep: true }).autoSleep).toBe(true);
    for (const v of [1, "true", {}, [], false, null]) {
      expect(normalizeResourceMode({ autoSleep: v }).autoSleep).toBe(false);
    }
  });
});

describe("resolvePolicy", () => {
  it("resolves a bare profile to its preset with nothing overridden", () => {
    const policy = policyFor({ profile: "efficient" });
    expect(policy.profile).toBe("efficient");
    expect(policy.capabilities).toEqual(PRESETS.efficient);
    expect(policy.overridden).toEqual([]);
  });

  it("applies overrides on top of the preset and reports them", () => {
    const policy = policyFor({
      profile: "efficient",
      overrides: { orchestrationConcurrency: 3, petFlavour: true },
    });
    expect(policy.capabilities.orchestrationConcurrency).toBe(3);
    expect(policy.capabilities.petFlavour).toBe(true);
    // Everything else still follows the preset.
    expect(policy.capabilities.gitSweepIntervalMs).toBe(PRESETS.efficient.gitSweepIntervalMs);
    expect(policy.overridden.sort()).toEqual(["orchestrationConcurrency", "petFlavour"]);
  });

  it("clearing an override returns exactly to the preset (no residue)", () => {
    const withOverride = policyFor({
      profile: "balanced",
      overrides: { gitSweepIntervalMs: 60_000 },
    });
    expect(withOverride.capabilities.gitSweepIntervalMs).toBe(60_000);
    const cleared = policyFor({ profile: "balanced", overrides: { gitSweepIntervalMs: null } });
    expect(cleared.capabilities).toEqual(PRESETS.balanced);
    expect(cleared.overridden).toEqual([]);
  });

  it("resolvePolicy never mutates the preset table", () => {
    resolvePolicy({
      profile: "balanced",
      overrides: { orchestrationConcurrency: 1 },
      autoSleep: false,
      schemaVersion: RESOURCE_MODE_SCHEMA_VERSION,
    });
    expect(PRESETS.balanced.orchestrationConcurrency).toBe(4);
  });

  it("every overridable key is a real capability", () => {
    for (const key of OVERRIDABLE_KEYS) {
      expect(PRESETS.balanced[key]).toBeDefined();
    }
  });
});

describe("effective poll intervals", () => {
  it("scales the GitHub interval by profile, keeping 0 = manual", () => {
    expect(effectiveGithubPollSeconds(policyFor({ profile: "balanced" }), 45)).toBe(45);
    expect(effectiveGithubPollSeconds(policyFor({ profile: "efficient" }), 45)).toBe(180);
    expect(effectiveGithubPollSeconds(policyFor({ profile: "performance" }), 45)).toBe(30);
    expect(effectiveGithubPollSeconds(policyFor({ profile: "efficient" }), 0)).toBe(0);
  });

  it("never lets performance push GitHub below the hard floor", () => {
    expect(effectiveGithubPollSeconds(policyFor({ profile: "performance" }), 31)).toBe(
      LIMITS.githubPollFloorSeconds,
    );
  });

  it("scales the usage refresh by profile with its own floor", () => {
    expect(effectiveUsageRefreshMinutes(policyFor({ profile: "balanced" }), 5)).toBe(5);
    expect(effectiveUsageRefreshMinutes(policyFor({ profile: "efficient" }), 5)).toBe(15);
    expect(effectiveUsageRefreshMinutes(policyFor({ profile: "efficient" }), 0)).toBe(0);
  });
});

describe("orchestration headroom", () => {
  const summaryWith = (updatedAtMs: number | undefined, cpu: number | null): ResourceSummary => ({
    enabled: true,
    capabilities: {
      cpu: true,
      memory: true,
      virtualMemory: true,
      io: true,
      startTime: true,
      validated: true,
    },
    sampling: { active: true, intervalMs: 3000, reason: "budget" },
    ...(updatedAtMs !== undefined ? { updatedAtMs } : {}),
    bufferSeconds: 600,
    total: {
      processes: 4,
      cpuPercent: cpu,
      cpuAvgPercent: cpu,
      cpuPeakPercent: cpu,
      residentBytes: 1,
      residentAvgBytes: 1,
      residentPeakBytes: 1,
      virtualBytes: 1,
      ioReadBytesPerSec: null,
      ioWriteBytesPerSec: null,
      trend: "steady",
    },
    groups: [],
    orphans: [],
    terminalsLinked: 0,
  });

  it("grants headroom only on a fresh summary with a known, low CPU", () => {
    const now = 1_000_000;
    expect(orchestrationHeadroom(summaryWith(now - 3000, 10), now)).toBe(true);
    expect(orchestrationHeadroom(summaryWith(now - 3000, HEADROOM_CPU_LIMIT_PERCENT), now)).toBe(
      false,
    );
    expect(orchestrationHeadroom(summaryWith(now - HEADROOM_MAX_AGE_MS - 1, 10), now)).toBe(false);
    expect(orchestrationHeadroom(summaryWith(now - 3000, null), now)).toBe(false);
    expect(orchestrationHeadroom(summaryWith(undefined, 10), now)).toBe(false);
    expect(orchestrationHeadroom(null, now)).toBe(false);
  });

  it("extends concurrency only under headroom, and only where the preset allows it", () => {
    const perf = policyFor({ profile: "performance" });
    expect(effectiveOrchestrationConcurrency(perf, true)).toBe(6);
    expect(effectiveOrchestrationConcurrency(perf, false)).toBe(4);
    const balanced = policyFor({ profile: "balanced" });
    expect(effectiveOrchestrationConcurrency(balanced, true)).toBe(4);
    const efficient = policyFor({ profile: "efficient" });
    expect(effectiveOrchestrationConcurrency(efficient, true)).toBe(2);
  });
});

describe("freshness relaxations", () => {
  it("efficient relaxes git, GitHub and usage; balanced and performance relax nothing", () => {
    expect(freshnessRelaxations(policyFor({ profile: "efficient" }))).toEqual({
      git: true,
      github: true,
      usage: true,
    });
    expect(freshnessRelaxations(policyFor({ profile: "balanced" }))).toEqual({
      git: false,
      github: false,
      usage: false,
    });
    expect(freshnessRelaxations(policyFor({ profile: "performance" }))).toEqual({
      git: false,
      github: false,
      usage: false,
    });
  });

  it("an override that slows the sweep flags the git surface even on balanced", () => {
    const policy = policyFor({ profile: "balanced", overrides: { gitSweepIntervalMs: 60_000 } });
    expect(freshnessRelaxations(policy).git).toBe(true);
  });
});
