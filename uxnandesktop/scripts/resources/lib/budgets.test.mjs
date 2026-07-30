import { describe, expect, it } from "vitest";

import {
  combineVerdicts,
  DEFAULT_REGRESSION_POLICY,
  evaluateBudget,
  evaluateRegression,
  unitOf,
} from "./budgets.mjs";

function agg(metrics, overrides = {}) {
  return {
    scenario: "R01",
    platform: { os: "windows" },
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([k, v]) => [k, { median: v, min: v, max: v, n: 5 }]),
    ),
    ...overrides,
  };
}

const BUDGET = {
  budgetVersion: 1,
  os: "windows",
  mode: "enforce",
  scenarios: { R01: { ownRssP50Mb: { warn: 250, fail: 300 }, cpuP95: { warn: 3, fail: 6 } } },
};

describe("unitOf", () => {
  it("reads the unit out of the metric name", () => {
    expect(unitOf("ownRssP50Mb")).toBe("mb");
    expect(unitOf("cpuP95")).toBe("cpuPct");
    expect(unitOf("launchToWindowMs")).toBe("ms");
    expect(unitOf("handlesP95")).toBe("count");
  });
});

describe("evaluateBudget", () => {
  it("passes under the warn line", () => {
    const v = evaluateBudget(agg({ ownRssP50Mb: 200, cpuP95: 1 }), BUDGET);
    expect(v.status).toBe("pass");
    expect(v.budgetVersion).toBe(1);
  });

  it("warns between the lines and fails above the fail line", () => {
    expect(evaluateBudget(agg({ ownRssP50Mb: 270 }), BUDGET).status).toBe("warn");
    expect(evaluateBudget(agg({ ownRssP50Mb: 340 }), BUDGET).status).toBe("fail");
  });

  it("downgrades a failure to a warning while the budget is in warn mode", () => {
    const warnMode = { ...BUDGET, mode: "warn" };
    expect(evaluateBudget(agg({ ownRssP50Mb: 340 }), warnMode).status).toBe("warn");
  });

  it("marks an unmeasured metric skipped rather than passed", () => {
    const v = evaluateBudget(agg({ ownRssP50Mb: 200 }), BUDGET);
    const cpu = v.checks.find((c) => c.metric === "cpuP95");
    expect(cpu.status).toBe("skipped");
    expect(v.status).toBe("pass"); // a skip does not turn the scenario red…
    expect(cpu.reason).toMatch(/not measured/);
  });

  it("is unknown when there is no budget at all", () => {
    const v = evaluateBudget(agg({ ownRssP50Mb: 200 }), null);
    expect(v.status).toBe("unknown");
    expect(v.notes.join(" ")).toMatch(/not judged/);
  });

  it("is unknown when the budget has no entry for this scenario", () => {
    const v = evaluateBudget(agg({ ownRssP50Mb: 200 }, { scenario: "R07" }), BUDGET);
    expect(v.status).toBe("unknown");
    expect(v.notes.join(" ")).toMatch(/no entry for R07/);
  });
});

describe("evaluateRegression", () => {
  const base = agg({ ownRssP50Mb: 200, cpuP95: 2, handlesP95: 1200 });

  it("passes when nothing moved", () => {
    expect(evaluateRegression(base, agg({ ownRssP50Mb: 201, cpuP95: 2 })).status).toBe("pass");
  });

  it("stays quiet for noise below both thresholds", () => {
    // +4 % and +8 MB: neither limit crossed.
    expect(evaluateRegression(base, agg({ ownRssP50Mb: 208 })).status).toBe("pass");
  });

  it("only warns when the relative jump is big but the absolute one is small", () => {
    // A 4 MB metric growing 50 % is 2 MB — real, but not worth blocking on.
    const small = agg({ ownRssP50Mb: 4 });
    expect(evaluateRegression(small, agg({ ownRssP50Mb: 6 })).status).toBe("warn");
  });

  it("fails when a change is both relatively and absolutely large", () => {
    // 200 → 260 MB: +30 % and +60 MB.
    const v = evaluateRegression(base, agg({ ownRssP50Mb: 260 }));
    expect(v.status).toBe("fail");
    const check = v.checks.find((c) => c.metric === "ownRssP50Mb");
    expect(check.absolute).toBe(60);
    expect(check.relative).toBeCloseTo(0.3, 4);
  });

  it("never fails an improvement", () => {
    expect(evaluateRegression(base, agg({ ownRssP50Mb: 120 })).status).toBe("pass");
  });

  it("is unknown with no baseline, and says so", () => {
    const v = evaluateRegression(null, agg({ ownRssP50Mb: 200 }));
    expect(v.status).toBe("unknown");
    expect(v.notes.join(" ")).toMatch(/no approved baseline/);
  });

  it("refuses to compare different scenarios or different platforms", () => {
    expect(evaluateRegression(base, agg({ ownRssP50Mb: 200 }, { scenario: "R02" })).status).toBe(
      "unknown",
    );
    const otherOs = agg({ ownRssP50Mb: 200 }, { platform: { os: "linux" } });
    expect(evaluateRegression(base, otherOs).notes.join(" ")).toMatch(/refusing to compare/);
  });

  it("skips a metric the candidate did not measure", () => {
    const v = evaluateRegression(base, agg({ ownRssP50Mb: 200 }));
    expect(v.checks.find((c) => c.metric === "handlesP95").status).toBe("skipped");
  });

  it("downgrades a failure in warn mode", () => {
    const v = evaluateRegression(base, agg({ ownRssP50Mb: 260 }), DEFAULT_REGRESSION_POLICY, "warn");
    expect(v.status).toBe("warn");
  });
});

describe("combineVerdicts", () => {
  it("keeps the worst status and concatenates the evidence", () => {
    const a = { status: "pass", checks: [{ metric: "x" }], notes: ["a"] };
    const b = { status: "warn", checks: [{ metric: "y" }], notes: ["b"] };
    const combined = combineVerdicts(a, b);
    expect(combined.status).toBe("warn");
    expect(combined.checks).toHaveLength(2);
    expect(combined.notes).toEqual(["a", "b"]);
  });
});
