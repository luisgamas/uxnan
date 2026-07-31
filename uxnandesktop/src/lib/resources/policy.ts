// Resource-mode policy engine — pure TS, no Svelte imports, no Tauri.
//
// One place answers "how much background work may run right now?": every
// consumer (git status sweeps, GitHub/provider polling, orchestration
// concurrency, the resource monitor's history, the pet, workspace auto-sleep)
// asks the resolved policy instead of reading settings and re-deriving its own
// conditions. Three explicit presets (`efficient` / `balanced` / `performance`)
// plus per-capability overrides, persisted as
// `{ profile, overrides, autoSleep, schemaVersion }` in `AppSettings`
// (`resourceMode`, mirrored by Rust `ResourceModeSettings` in `model.rs`).
//
// Ground rules, mirrored by the tests:
//
// - **`balanced` IS the pre-mode behavior.** Its values are the constants the
//   consumers used before the mode existed, so the default changes nothing.
// - **Validation never leaves residue.** An unknown profile, an unknown
//   override key, a wrong-typed or out-of-range value — each normalizes away
//   (profile → balanced, override → inherit) instead of surviving to bite a
//   consumer. `null` means "inherit from the preset".
// - **Hard safety limits sit outside overrides.** No override can push a
//   cadence below its floor or a cap above its ceiling (`LIMITS`).
// - **The mode only governs local infrastructure.** Nothing here touches agent
//   models, permissions, OS priority or processes uxnan did not spawn.

import type { ResourceModeSettings, ResourceSummary } from "$lib/types";

/** The selectable presets, least- to most-eager. */
export const RESOURCE_PROFILES = ["efficient", "balanced", "performance"] as const;
export type ResourceProfile = (typeof RESOURCE_PROFILES)[number];

/** What the auto-sleep capability may do (always additionally gated by the
 *  `autoSleep` feature flag — see [`NormalizedResourceMode`]). */
export const AUTO_SLEEP_LEVELS = ["off", "suggest", "auto"] as const;
export type WorkspaceAutoSleepLevel = (typeof AUTO_SLEEP_LEVELS)[number];

/** Everything a preset governs, resolved to concrete values. */
export interface ResourceCapabilities {
  /** Minimum gap between unforced all-worktree git status sweeps (ms). Forced
   *  sweeps (focus, agent activity, our own git actions) always run. */
  gitSweepIntervalMs: number;
  /** Minimum gap between worktree-list reconcile polls (ms). `0` = every
   *  driver tick (the pre-mode behavior). */
  worktreeReconcileIntervalMs: number;
  /** Multiplier over the user's GitHub poll interval (Settings → GitHub).
   *  `> 1` relaxes, `< 1` tightens — never below the hard floor. */
  githubPollFactor: number;
  /** Multiplier over the user's provider-usage refresh interval. */
  usageRefreshFactor: number;
  /** Steps one orchestration run may execute concurrently. */
  orchestrationConcurrency: number;
  /** Extra concurrency ceiling used **only while measured headroom exists**
   *  (see [`orchestrationHeadroom`]); `null` = never extend. */
  orchestrationExtendedConcurrency: number | null;
  /** How much aggregated history the resource monitor's buffer retains (s). */
  resourceHistorySeconds: number;
  /** Whether the pet plays decorative idle one-shots (state changes always
   *  render — reducing flavour never hides information). */
  petFlavour: boolean;
  /** What auto-sleep may do once its feature flag is on. */
  workspaceAutoSleep: WorkspaceAutoSleepLevel;
  /** How long a workspace must be inactive before auto-sleep considers it. */
  autoSleepIdleMinutes: number;
}

/** The capability keys a user may override per-capability (Settings →
 *  Resources → Resource mode → Advanced). Everything else follows the preset. */
export const OVERRIDABLE_KEYS = [
  "gitSweepIntervalMs",
  "orchestrationConcurrency",
  "resourceHistorySeconds",
  "petFlavour",
  "workspaceAutoSleep",
  "autoSleepIdleMinutes",
] as const;
export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];
export type ResourceOverrides = Partial<Pick<ResourceCapabilities, OverridableKey>>;

/** Hard safety bounds (never overridable): a cadence can never be pushed into
 *  a busy loop, a cap never past what the machinery tolerates. */
export const LIMITS = {
  gitSweepIntervalMs: { min: 5_000, max: 600_000 },
  orchestrationConcurrency: { min: 1, max: 8 },
  resourceHistorySeconds: { min: 60, max: 600 },
  autoSleepIdleMinutes: { min: 5, max: 480 },
  /** Effective GitHub poll floor (s) — "more frequent" must never mean
   *  hammering the API. `0` (manual only) is always respected. */
  githubPollFloorSeconds: 30,
  /** Effective provider-usage refresh floor (min); `0` stays manual. */
  usageRefreshFloorMinutes: 1,
} as const;

/** The three presets. `balanced` mirrors the constants the consumers shipped
 *  with before the mode existed (15 s sweep, every-tick reconcile, 1× polls,
 *  4 concurrent steps, 10 min history, flavour on, no auto-sleep). */
export const PRESETS: Record<ResourceProfile, ResourceCapabilities> = {
  efficient: {
    gitSweepIntervalMs: 45_000,
    worktreeReconcileIntervalMs: 10_000,
    githubPollFactor: 4,
    usageRefreshFactor: 3,
    orchestrationConcurrency: 2,
    orchestrationExtendedConcurrency: null,
    resourceHistorySeconds: 180,
    petFlavour: false,
    workspaceAutoSleep: "suggest",
    autoSleepIdleMinutes: 30,
  },
  balanced: {
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
  },
  performance: {
    gitSweepIntervalMs: 10_000,
    worktreeReconcileIntervalMs: 0,
    githubPollFactor: 0.5,
    usageRefreshFactor: 1,
    orchestrationConcurrency: 4,
    // "Fresher / more parallel" is allowed only against measured headroom —
    // the budget-lease summary must show uxnan itself has CPU to spare.
    orchestrationExtendedConcurrency: 6,
    resourceHistorySeconds: 600,
    petFlavour: true,
    workspaceAutoSleep: "off",
    autoSleepIdleMinutes: 30,
  },
};

/** The current persisted schema version. */
export const RESOURCE_MODE_SCHEMA_VERSION = 1;

/** A validated, residue-free view of the persisted settings. */
export interface NormalizedResourceMode {
  profile: ResourceProfile;
  overrides: ResourceOverrides;
  autoSleep: boolean;
  schemaVersion: typeof RESOURCE_MODE_SCHEMA_VERSION;
}

/** The resolved policy consumers read: the preset merged with the valid
 *  overrides, plus which keys were actually overridden (for the UI). */
export interface ResolvedResourcePolicy {
  profile: ResourceProfile;
  capabilities: ResourceCapabilities;
  overridden: OverridableKey[];
  /** Whether the auto-sleep feature flag is on (the capability level still
   *  decides what, if anything, runs). */
  autoSleepEnabled: boolean;
}

function isProfile(value: unknown): value is ResourceProfile {
  return typeof value === "string" && (RESOURCE_PROFILES as readonly string[]).includes(value);
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Validate one override value for one capability. Returns the clamped value,
 *  or `undefined` when the value is invalid (→ inherit). */
function normalizeOverride(key: OverridableKey, value: unknown): ResourceOverrides[OverridableKey] {
  switch (key) {
    case "gitSweepIntervalMs":
    case "resourceHistorySeconds":
    case "autoSleepIdleMinutes":
    case "orchestrationConcurrency": {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      const bounds = LIMITS[key];
      return clamp(Math.round(value), bounds.min, bounds.max);
    }
    case "petFlavour":
      return typeof value === "boolean" ? value : undefined;
    case "workspaceAutoSleep":
      return typeof value === "string" &&
        (AUTO_SLEEP_LEVELS as readonly string[]).includes(value)
        ? (value as WorkspaceAutoSleepLevel)
        : undefined;
  }
}

/**
 * Normalize whatever was persisted into a clean v1 document.
 *
 * - not an object (corrupt / absent) → Balanced with no overrides;
 * - a schema version from a **newer** build (> 1) → Balanced with no overrides,
 *   because applying overrides whose meaning this build cannot know is exactly
 *   the residue the rollback path must not leave;
 * - unknown profile → `balanced`; unknown/invalid/`null` overrides → inherit.
 */
export function normalizeResourceMode(raw: unknown): NormalizedResourceMode {
  const fallback: NormalizedResourceMode = {
    profile: "balanced",
    overrides: {},
    autoSleep: false,
    schemaVersion: RESOURCE_MODE_SCHEMA_VERSION,
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const doc = raw as ResourceModeSettings;
  if (
    typeof doc.schemaVersion === "number" &&
    Number.isInteger(doc.schemaVersion) &&
    doc.schemaVersion > RESOURCE_MODE_SCHEMA_VERSION
  ) {
    return fallback;
  }

  const overrides: ResourceOverrides = {};
  if (doc.overrides !== null && typeof doc.overrides === "object" && !Array.isArray(doc.overrides)) {
    for (const key of OVERRIDABLE_KEYS) {
      const value = (doc.overrides as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue; // inherit
      const normalized = normalizeOverride(key, value);
      if (normalized !== undefined) {
        (overrides as Record<string, unknown>)[key] = normalized;
      }
    }
  }

  return {
    profile: isProfile(doc.profile) ? doc.profile : "balanced",
    overrides,
    autoSleep: doc.autoSleep === true,
    schemaVersion: RESOURCE_MODE_SCHEMA_VERSION,
  };
}

/** Resolve the policy: preset values, then the (already-clamped) overrides. */
export function resolvePolicy(mode: NormalizedResourceMode): ResolvedResourcePolicy {
  const capabilities: ResourceCapabilities = { ...PRESETS[mode.profile] };
  const overridden: OverridableKey[] = [];
  for (const key of OVERRIDABLE_KEYS) {
    const value = mode.overrides[key];
    if (value === undefined) continue;
    (capabilities as unknown as Record<string, unknown>)[key] = value;
    overridden.push(key);
  }
  return {
    profile: mode.profile,
    capabilities,
    overridden,
    autoSleepEnabled: mode.autoSleep,
  };
}

/** One-step convenience for stores: persisted blob → resolved policy. */
export function resolveFromSettings(raw: unknown): ResolvedResourcePolicy {
  return resolvePolicy(normalizeResourceMode(raw));
}

// --- consumer helpers ---------------------------------------------------------

/** Effective GitHub poll interval (s) from the user's configured one. `0`
 *  (manual only) is always respected; anything else is scaled by the profile
 *  and floored so "more frequent" can never turn aggressive. */
export function effectiveGithubPollSeconds(
  policy: ResolvedResourcePolicy,
  configuredSeconds: number,
): number {
  if (configuredSeconds <= 0) return 0;
  return Math.max(
    LIMITS.githubPollFloorSeconds,
    Math.round(configuredSeconds * policy.capabilities.githubPollFactor),
  );
}

/** Effective provider-usage refresh interval (min). `0` stays manual-only. */
export function effectiveUsageRefreshMinutes(
  policy: ResolvedResourcePolicy,
  configuredMinutes: number,
): number {
  if (configuredMinutes <= 0) return 0;
  return Math.max(
    LIMITS.usageRefreshFloorMinutes,
    Math.round(configuredMinutes * policy.capabilities.usageRefreshFactor),
  );
}

/** A summary older than this is no evidence of headroom. Comfortably above the
 *  budget lease's 3 s cadence, well below "the sampler parked long ago". */
export const HEADROOM_MAX_AGE_MS = 15_000;
/** uxnan's own measured CPU (whole-machine %) above which no extra
 *  parallelism is granted. */
export const HEADROOM_CPU_LIMIT_PERCENT = 50;

/**
 * Whether the extended orchestration concurrency may apply right now.
 *
 * Evidence-based on purpose: it needs a **fresh** summary (the budget lease
 * must actually be sampling) whose uxnan-total CPU is known and below the
 * limit. No summary, a stale one, or an unknown CPU all answer `false` — the
 * absence of a measurement is never treated as capacity.
 */
export function orchestrationHeadroom(summary: ResourceSummary | null, nowMs: number): boolean {
  if (!summary || summary.updatedAtMs === undefined) return false;
  if (nowMs - summary.updatedAtMs > HEADROOM_MAX_AGE_MS) return false;
  const cpu = summary.total?.cpuPercent;
  if (cpu === null || cpu === undefined) return false;
  return cpu < HEADROOM_CPU_LIMIT_PERCENT;
}

/** The per-tick orchestration concurrency cap: the base, or the extended
 *  ceiling while measured headroom exists. */
export function effectiveOrchestrationConcurrency(
  policy: ResolvedResourcePolicy,
  headroom: boolean,
): number {
  const base = policy.capabilities.orchestrationConcurrency;
  const extended = policy.capabilities.orchestrationExtendedConcurrency;
  if (extended === null || !headroom) return base;
  return Math.max(base, Math.min(extended, LIMITS.orchestrationConcurrency.max));
}

/** Which surfaces are showing less-fresh data than Balanced would — each such
 *  surface owes the user an indicator plus a manual "refresh now" action. */
export interface FreshnessRelaxations {
  git: boolean;
  github: boolean;
  usage: boolean;
}

export function freshnessRelaxations(policy: ResolvedResourcePolicy): FreshnessRelaxations {
  const balanced = PRESETS.balanced;
  return {
    git: policy.capabilities.gitSweepIntervalMs > balanced.gitSweepIntervalMs,
    github: policy.capabilities.githubPollFactor > balanced.githubPollFactor,
    usage: policy.capabilities.usageRefreshFactor > balanced.usageRefreshFactor,
  };
}
