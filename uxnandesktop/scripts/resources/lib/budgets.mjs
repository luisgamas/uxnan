/**
 * Turning measurements into a verdict.
 *
 * Two independent questions, deliberately kept apart:
 *
 * 1. **Is this within budget?** An absolute per-scenario, per-platform ceiling.
 *    Absolute limits cannot be shared across platforms — a WebView2 process tree
 *    and a WebKitGTK one differ by more than any regression we would ever care
 *    about — so each OS carries its own file.
 * 2. **Did it get worse?** A relative comparison against an approved baseline
 *    artifact. This is the one that actually catches gradual drift, and it only
 *    fires when a change is **both** relatively large and absolutely large, so
 *    a 20 % jump on a 4 MB number stays quiet.
 *
 * Until a baseline exists on real hardware, budgets ship in `mode: "warn"`: every
 * `fail` is reported as a `warn` and CI stays green. Flipping the mode is a
 * reviewable one-line change with the evidence attached — which is the point.
 */

import { relativeDelta, round } from "./stats.mjs";
import { worstOf } from "./schema.mjs";

/** Metrics compared against a baseline when a budget doesn't name its own.
 *  Both memory families are here on purpose: a change that moves shared webview
 *  pages around shows up in one and not the other. */
export const DEFAULT_REGRESSION_METRICS = [
  "ownPrivateP50Mb",
  "ownRssP50Mb",
  "ownRssP95Mb",
  "managedPrivateP50Mb",
  "managedRssP50Mb",
  "cpuP95",
  "handlesP95",
  "threadsP95",
];

/** Default regression policy — the plan's "clear relative regression" rule. */
export const DEFAULT_REGRESSION_POLICY = {
  /** Fraction, e.g. 0.15 = +15 %. */
  relative: 0.15,
  /** Absolute change that must *also* be exceeded, in the metric's own unit
   *  (MB for `*Mb`, percent-of-core for `cpu*`, count otherwise). */
  absolute: { mb: 10, cpuPct: 2, count: 200, ms: 500 },
};

/** Which unit family a metric name belongs to (encoded in the name by design). */
export function unitOf(metric) {
  if (/Mb$/i.test(metric)) return "mb";
  if (/^cpu|Cpu/.test(metric)) return "cpuPct";
  if (/Ms$/i.test(metric)) return "ms";
  return "count";
}

/**
 * Check one scenario aggregate against its absolute budget.
 *
 * A metric with no entry in the budget is reported as `skipped`, not as a pass:
 * "we never looked" and "we looked and it was fine" must not read the same.
 */
export function evaluateBudget(aggregate, budget) {
  const checks = [];
  const scenarioBudget = budget?.scenarios?.[aggregate?.scenario];

  if (!budget) {
    return {
      status: "unknown",
      budgetVersion: null,
      checks,
      notes: ["no budget file for this platform — the run was recorded but not judged"],
    };
  }
  if (!scenarioBudget) {
    return {
      status: "unknown",
      budgetVersion: budget.budgetVersion ?? null,
      checks,
      notes: [`budget ${budget.budgetVersion ?? "?"} has no entry for ${aggregate?.scenario}`],
    };
  }

  for (const [metric, limits] of Object.entries(scenarioBudget)) {
    const measured = aggregate?.metrics?.[metric]?.median;
    if (typeof measured !== "number") {
      checks.push({
        metric,
        status: "skipped",
        measured: null,
        limit: limits,
        reason: "not measured on this platform",
      });
      continue;
    }
    let status = "pass";
    let limit = null;
    if (typeof limits.fail === "number" && measured > limits.fail) {
      status = "fail";
      limit = limits.fail;
    } else if (typeof limits.warn === "number" && measured > limits.warn) {
      status = "warn";
      limit = limits.warn;
    }
    checks.push({ metric, status, measured, limit, budget: limits });
  }

  const status = applyMode(
    worstOf(checks.filter((c) => c.status !== "skipped").map((c) => c.status)),
    budget.mode,
  );
  return { status, budgetVersion: budget.budgetVersion ?? null, checks, notes: [] };
}

/**
 * Compare a candidate against an approved baseline for the same scenario.
 *
 * Both thresholds must be crossed for a `fail`; crossing only the relative one
 * is a `warn`, because that is exactly the shape of both real early drift and of
 * ordinary noise, and the reader — not the gate — should decide which it is.
 */
export function evaluateRegression(baseline, candidate, policy = DEFAULT_REGRESSION_POLICY, mode) {
  const checks = [];
  if (!baseline) {
    return {
      status: "unknown",
      checks,
      notes: ["no approved baseline for this scenario/platform — nothing to compare against"],
    };
  }
  if (baseline.scenario !== candidate.scenario) {
    return {
      status: "unknown",
      checks,
      notes: [
        `baseline is ${baseline.scenario} but the candidate is ${candidate.scenario} — refusing to compare`,
      ],
    };
  }
  if (baseline.platform?.os !== candidate.platform?.os) {
    return {
      status: "unknown",
      checks,
      notes: [
        `baseline ran on ${baseline.platform?.os} and the candidate on ${candidate.platform?.os} — refusing to compare`,
      ],
    };
  }

  const metrics = policy.metrics ?? DEFAULT_REGRESSION_METRICS;
  for (const metric of metrics) {
    const before = baseline.metrics?.[metric]?.median;
    const after = candidate.metrics?.[metric]?.median;
    if (typeof before !== "number" || typeof after !== "number") {
      checks.push({ metric, status: "skipped", before: before ?? null, after: after ?? null });
      continue;
    }
    const absolute = after - before;
    const relative = relativeDelta(before, after);
    const absLimit = policy.absolute?.[unitOf(metric)] ?? Infinity;
    const relOver = relative !== null && relative > policy.relative;
    const absOver = absolute > absLimit;
    const status = relOver && absOver ? "fail" : relOver || absOver ? "warn" : "pass";
    checks.push({
      metric,
      status,
      before,
      after,
      absolute: round(absolute),
      relative: round(relative, 4),
      relativeLimit: policy.relative,
      absoluteLimit: Number.isFinite(absLimit) ? absLimit : null,
    });
  }

  const status = applyMode(
    worstOf(checks.filter((c) => c.status !== "skipped").map((c) => c.status)),
    mode,
  );
  return { status, checks, notes: [] };
}

/** In `warn` mode a `fail` is downgraded — the gate reports, it doesn't block. */
function applyMode(status, mode) {
  if (mode === "warn" && status === "fail") return "warn";
  return status;
}

/** Combine an absolute-budget verdict and a regression verdict. */
export function combineVerdicts(...verdicts) {
  return {
    status: worstOf(verdicts.map((v) => v?.status ?? "unknown")),
    checks: verdicts.flatMap((v) => v?.checks ?? []),
    notes: verdicts.flatMap((v) => v?.notes ?? []),
  };
}
