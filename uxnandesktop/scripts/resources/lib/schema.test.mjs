import { describe, expect, it } from "vitest";

import {
  aggregateRepeats,
  newRun,
  SCHEMA_VERSION,
  summarizeRun,
  validateRun,
  worstOf,
} from "./schema.mjs";

const PLATFORM = {
  os: "windows",
  arch: "x86_64",
  webview: "140.0.0.0",
  cpuCores: 8,
  totalMemMb: 32000,
};

function sample(t, own, managed, external = 0, extra = {}) {
  const bucket = (rssMb, cpuPct = 1) => ({
    procs: 1,
    rssMb,
    // Private is always lower than the working-set sum: the webview processes
    // share pages, and only `rssMb` counts them more than once.
    privateMb: Math.round(rssMb * 0.45),
    threads: 20,
    handles: 300,
    cpuPct,
  });
  return {
    t,
    own: bucket(own, extra.cpu ?? 1),
    managed: bucket(managed, extra.cpu ?? 2),
    external: bucket(external, 0),
  };
}

function validDoc(overrides = {}) {
  const doc = newRun({
    scenario: "R01",
    commit: "abc1234",
    platform: PLATFORM,
    configuration: { buildProfile: "release" },
  });
  doc.samples = [sample(0, 200, 220), sample(1000, 210, 230)];
  doc.verdict = { status: "pass", budgetVersion: 1, checks: [] };
  return { ...doc, ...overrides };
}

describe("validateRun", () => {
  it("accepts a well-formed document", () => {
    expect(validateRun(validDoc())).toEqual({ ok: true, errors: [] });
  });

  it("names the exact field that is wrong", () => {
    const doc = validDoc();
    doc.samples[1] = { t: "later", own: {}, managed: {}, external: {} };
    const { ok, errors } = validateRun(doc);
    expect(ok).toBe(false);
    expect(errors).toContain("samples[1].t is not a number (ms since start)");
    expect(errors).toContain("samples[1].own.rssMb is not a number");
  });

  it("refuses a debug run rather than letting it be compared", () => {
    const doc = validDoc();
    doc.configuration = { buildProfile: "debug-ish" };
    const { ok, errors } = validateRun(doc);
    expect(ok).toBe(false);
    expect(errors.join(" ")).toMatch(/buildProfile must be 'release' or 'debug'/);
  });

  it("rejects a document written by a future schema", () => {
    const doc = validDoc({ schemaVersion: SCHEMA_VERSION + 1 });
    expect(validateRun(doc).errors.join(" ")).toMatch(/this tool reads version/);
  });

  it("requires the machine facts a number is meaningless without", () => {
    const doc = validDoc({ platform: { os: "windows", arch: "x86_64" } });
    const { errors } = validateRun(doc);
    expect(errors.join(" ")).toMatch(/platform.webview is missing/);
    expect(errors.join(" ")).toMatch(/platform.cpuCores/);
  });

  it("rejects an unknown scenario id", () => {
    expect(validateRun(validDoc({ scenario: "R99" })).ok).toBe(false);
  });
});

describe("summarizeRun", () => {
  it("discards the stabilisation window from the resting figures", () => {
    const doc = validDoc();
    doc.samples = [sample(0, 500, 520), sample(30_000, 200, 220), sample(60_000, 210, 230)];
    const summary = summarizeRun(doc, { stableFromMs: 30_000 });
    expect(summary.stableSamples).toBe(2);
    expect(summary.ownRssP50Mb).toBe(205); // the 500 MB warm-up sample is excluded
  });

  it("promotes phase markers to gate-able metrics", () => {
    const doc = validDoc();
    doc.phases = [{ name: "launchToWindow", atMs: 1234.6 }];
    expect(summarizeRun(doc).launchToWindowMs).toBe(1235);
  });

  it("reports a soak's growth as a slope per hour", () => {
    const doc = validDoc();
    doc.samples = [0, 1, 2, 3].map((i) => sample(i * 1_800_000, 200 + i * 5, 220 + i * 5));
    expect(summarizeRun(doc).ownRssSlopeMbPerHour).toBeCloseTo(10, 5);
  });

  it("refuses to extrapolate a slope from a short window", () => {
    // 45 s of warm-up would read as thousands of MB/h — an artefact, not a leak.
    const doc = validDoc();
    doc.samples = [0, 15, 30, 45].map((s) => sample(s * 1000, 200 + s, 220 + s));
    expect(summarizeRun(doc).ownRssSlopeMbPerHour).toBeNull();
    expect(summarizeRun(doc).managedRssSlopeMbPerHour).toBeNull();
  });

  it("publishes private memory beside working set, since the two answer different questions", () => {
    const doc = validDoc();
    expect(doc.samples[0].own.privateMb).toBeTypeOf("number");
    const summary = summarizeRun(doc);
    expect(summary.ownPrivateP50Mb).toBeTypeOf("number");
    expect(summary.ownPrivateP50Mb).not.toBe(summary.ownRssP50Mb);
  });

  it("yields nulls, not zeros, when nothing was sampled", () => {
    const doc = validDoc();
    doc.samples = [];
    const summary = summarizeRun(doc);
    expect(summary.ownRssP50Mb).toBeNull();
    expect(summary.cpuP95).toBeNull();
  });
});

describe("aggregateRepeats", () => {
  it("takes the median across repetitions and keeps the spread", () => {
    const runs = [200, 210, 260].map((mb) => {
      const doc = validDoc();
      doc.summary = { ownRssP50Mb: mb };
      doc.verdict = { status: "pass" };
      return doc;
    });
    const agg = aggregateRepeats(runs);
    expect(agg.repeats).toBe(3);
    expect(agg.metrics.ownRssP50Mb).toEqual({ median: 210, min: 200, max: 260, n: 3 });
  });

  it("carries the worst verdict of the set", () => {
    const runs = ["pass", "warn", "pass"].map((status) => {
      const doc = validDoc();
      doc.summary = { ownRssP50Mb: 1 };
      doc.verdict = { status };
      return doc;
    });
    expect(aggregateRepeats(runs).verdict).toBe("warn");
  });

  it("is null for no runs at all", () => {
    expect(aggregateRepeats([])).toBeNull();
  });
});

describe("worstOf", () => {
  it("orders pass < warn < fail < unknown", () => {
    expect(worstOf(["pass", "pass"])).toBe("pass");
    expect(worstOf(["pass", "warn"])).toBe("warn");
    expect(worstOf(["warn", "fail"])).toBe("fail");
    // An unevaluated result must never read as a pass.
    expect(worstOf(["fail", "unknown"])).toBe("unknown");
    expect(worstOf([])).toBe("pass");
  });
});
