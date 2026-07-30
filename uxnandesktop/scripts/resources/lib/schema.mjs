/**
 * The result contract: what one scenario run produces, and what a valid
 * document must contain.
 *
 * The schema is versioned, the raw results are not committed — only approved
 * summaries, fixtures, budgets and this file. A reader two years from now has to
 * be able to tell what a number meant, so every metric name encodes its bucket
 * (`own` / `managed` / `external`), its statistic (`P50` / `P95`) and its unit
 * (`Mb`, `Ms`, `Pct`).
 *
 * `null` always means **not measured on this platform** — never zero. That
 * distinction is the whole reason a Linux run can be compared with a Windows one
 * without inventing handles counts that don't exist there.
 */

import { percentile, round, slopePerHour, summarize } from "./stats.mjs";

/** Bump only for a breaking change to the document shape. */
export const SCHEMA_VERSION = 1;

/** Verdict values, worst last — `worstOf` relies on the order. */
export const VERDICTS = ["pass", "warn", "fail", "unknown"];

/** Shortest stable window a memory slope is reported over (10 minutes). Below
 *  it, the fit is dominated by warm-up and the per-hour extrapolation is noise
 *  wearing a leak's clothes. */
export const SLOPE_MIN_WINDOW_MS = 10 * 60 * 1000;

/** Every canonical scenario id the schema accepts. */
export const SCENARIO_IDS = [
  "R00",
  "R01",
  "R02",
  "R03",
  "R04",
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
];

/**
 * Build an empty, valid run document. Callers fill `samples`, `phases`,
 * `summary` and `verdict` as the run progresses, so a crashed run still writes
 * something a human can read.
 */
export function newRun({ scenario, commit, platform, configuration }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    commit: commit ?? "unknown",
    platform,
    scenario,
    configuration,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    phases: [],
    samples: [],
    /** Executable basenames present in the tree at teardown — enough to tell a
     *  run with a shell from one without, and nothing more (see `redact.mjs`). */
    processes: { atEnd: [] },
    orphans: [],
    notes: [],
    summary: null,
    verdict: { status: "unknown", budgetVersion: null, checks: [] },
  };
}

/**
 * Validate a run document. Returns `{ ok, errors }` where each error is a
 * sentence a person can act on ("samples[3].t is not a number") rather than a
 * schema path.
 */
export function validateRun(doc) {
  const errors = [];
  const need = (cond, message) => {
    if (!cond) errors.push(message);
  };

  need(doc && typeof doc === "object", "the document is not an object");
  if (errors.length > 0) return { ok: false, errors };

  need(
    doc.schemaVersion === SCHEMA_VERSION,
    `schemaVersion is ${JSON.stringify(doc.schemaVersion)}; this tool reads version ${SCHEMA_VERSION}`,
  );
  need(typeof doc.commit === "string" && doc.commit.length > 0, "commit is missing");
  need(
    SCENARIO_IDS.includes(doc.scenario),
    `scenario ${JSON.stringify(doc.scenario)} is not one of ${SCENARIO_IDS.join(", ")}`,
  );

  const p = doc.platform;
  need(p && typeof p === "object", "platform is missing");
  if (p && typeof p === "object") {
    need(typeof p.os === "string" && p.os.length > 0, "platform.os is missing");
    need(typeof p.arch === "string" && p.arch.length > 0, "platform.arch is missing");
    need(
      "webview" in p,
      "platform.webview is missing (use null when the runtime version can't be read)",
    );
    need(
      Number.isFinite(p.cpuCores) && p.cpuCores > 0,
      "platform.cpuCores must be a positive number (CPU percentages are meaningless without it)",
    );
  }

  need(
    doc.configuration && typeof doc.configuration === "object",
    "configuration is missing (record the build profile and settings the run used)",
  );
  if (doc.configuration && typeof doc.configuration === "object") {
    need(
      doc.configuration.buildProfile === "release" || doc.configuration.buildProfile === "debug",
      "configuration.buildProfile must be 'release' or 'debug' — debug and release numbers are never comparable",
    );
  }

  need(Array.isArray(doc.samples), "samples must be an array");
  if (Array.isArray(doc.samples)) {
    doc.samples.forEach((s, i) => {
      if (!s || typeof s !== "object") {
        errors.push(`samples[${i}] is not an object`);
        return;
      }
      if (!Number.isFinite(s.t)) errors.push(`samples[${i}].t is not a number (ms since start)`);
      for (const bucket of ["own", "managed", "external"]) {
        if (!s[bucket] || typeof s[bucket] !== "object") {
          errors.push(`samples[${i}].${bucket} is missing`);
          continue;
        }
        if (!Number.isFinite(s[bucket].rssMb)) {
          errors.push(`samples[${i}].${bucket}.rssMb is not a number`);
        }
      }
    });
  }

  need(
    doc.verdict && typeof doc.verdict === "object" && VERDICTS.includes(doc.verdict.status),
    `verdict.status must be one of ${VERDICTS.join(", ")}`,
  );

  return { ok: errors.length === 0, errors };
}

/**
 * Reduce a run's samples to the published summary.
 *
 * `stableFromMs` drops the stabilisation window: an app that just launched is
 * still paging in its webview, and folding that into a "resting cost" figure
 * would report a number no user ever experiences. Samples before that mark still
 * live in the document (they *are* the launch measurement) but never reach the
 * resting statistics.
 */
export function summarizeRun(doc, { stableFromMs = 0 } = {}) {
  const stable = (doc.samples ?? []).filter((s) => Number.isFinite(s.t) && s.t >= stableFromMs);
  const pick = (bucket, field) => stable.map((s) => s[bucket]?.[field]).filter((v) => v !== null);
  // A memory trend is only a trend over a long window. See the slope metrics.
  const span = stable.length > 1 ? stable[stable.length - 1].t - stable[0].t : 0;
  const longEnough = span >= SLOPE_MIN_WINDOW_MS;

  const summary = {
    stableFromMs,
    stableSamples: stable.length,

    // Memory, one figure per bucket — never summed across buckets.
    //
    // Two families, because neither alone is honest about a multi-process
    // webview. `Rss` is the sum of per-process working sets: it double-counts
    // the pages the WebView2/WebKit processes share with each other, so it
    // over-reports the machine's actual burden while staying a good
    // like-for-like signal between runs. `Private` sums private committed
    // bytes: nothing is counted twice, which makes it the defensible answer to
    // "how much memory is this costing me". Windows reports both; the Unix
    // collector has no cheap private figure, so there it is `null`.
    ownRssP50Mb: round(percentile(pick("own", "rssMb"), 0.5)),
    ownRssP95Mb: round(percentile(pick("own", "rssMb"), 0.95)),
    managedRssP50Mb: round(percentile(pick("managed", "rssMb"), 0.5)),
    managedRssP95Mb: round(percentile(pick("managed", "rssMb"), 0.95)),
    externalRssP50Mb: round(percentile(pick("external", "rssMb"), 0.5)),
    ownPrivateP50Mb: round(percentile(pick("own", "privateMb"), 0.5)),
    ownPrivateP95Mb: round(percentile(pick("own", "privateMb"), 0.95)),
    managedPrivateP50Mb: round(percentile(pick("managed", "privateMb"), 0.5)),
    externalPrivateP50Mb: round(percentile(pick("external", "privateMb"), 0.5)),

    // CPU is percent of ONE core; divide by platform.cpuCores for the machine.
    cpuP50: round(percentile(pick("managed", "cpuPct"), 0.5)),
    cpuP95: round(percentile(pick("managed", "cpuPct"), 0.95)),
    ownCpuP95: round(percentile(pick("own", "cpuPct"), 0.95)),

    ownProcsP50: round(percentile(pick("own", "procs"), 0.5), 0),
    managedProcsP50: round(percentile(pick("managed", "procs"), 0.5), 0),
    threadsP95: round(percentile(pick("managed", "threads"), 0.95), 0),
    handlesP95: round(percentile(pick("managed", "handles"), 0.95), 0),

    // Soak signal: is resting memory going anywhere? Only computed over a
    // window long enough for the answer to mean something — extrapolating a
    // one-minute warm-up to an hour produces four-digit "leaks" that are pure
    // artefact, and a fabricated alarm costs more trust than a missing number.
    ownRssSlopeMbPerHour: longEnough
      ? round(slopePerHour(stable.map((s) => ({ x: s.t, y: s.own?.rssMb }))), 2)
      : null,
    managedRssSlopeMbPerHour: longEnough
      ? round(slopePerHour(stable.map((s) => ({ x: s.t, y: s.managed?.rssMb }))), 2)
      : null,

    orphanCount: Array.isArray(doc.orphans) ? doc.orphans.length : null,
    durationMs: doc.durationMs ?? null,
  };

  // Phase timings become first-class metrics so a budget can gate them.
  for (const phase of doc.phases ?? []) {
    if (typeof phase?.name === "string" && Number.isFinite(phase.atMs)) {
      summary[`${phase.name}Ms`] = round(phase.atMs, 0);
    }
  }
  return summary;
}

/**
 * Merge the per-repetition runs of one scenario into a single comparable record.
 * Repetitions exist because a single launch on a busy desktop is noise; the
 * median across them is what a budget is checked against, and the spread is
 * published so a reader can see how noisy the box was.
 */
export function aggregateRepeats(runs) {
  if (runs.length === 0) return null;
  const first = runs[0];
  const metrics = {};
  const names = new Set(runs.flatMap((r) => Object.keys(r.summary ?? {})));
  for (const name of names) {
    if (name === "stableFromMs" || name === "stableSamples") continue;
    const values = runs.map((r) => r.summary?.[name]).filter((v) => typeof v === "number");
    const s = summarize(values);
    if (s) metrics[name] = { median: s.p50, min: s.min, max: s.max, n: s.n };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    scenario: first.scenario,
    commit: first.commit,
    platform: first.platform,
    configuration: first.configuration,
    repeats: runs.length,
    metrics,
    verdict: worstOf(runs.map((r) => r.verdict?.status ?? "unknown")),
    notes: [...new Set(runs.flatMap((r) => r.notes ?? []))],
  };
}

/** The worst status in a list (`unknown` counts as worse than `fail`: an
 *  unevaluated result must never read as a pass). */
export function worstOf(statuses) {
  let worst = "pass";
  for (const s of statuses) {
    if (VERDICTS.indexOf(s) > VERDICTS.indexOf(worst)) worst = s;
  }
  return worst;
}
