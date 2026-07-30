/**
 * The human-readable half of a result.
 *
 * A JSON document is what CI compares; a Markdown report is what a person reads
 * before deciding whether a number is believable. It therefore leads with the
 * conditions (OS, webview, cores, build profile, repetitions) rather than the
 * headline figure — a memory number without them is not a claim anybody can
 * defend.
 */

const STATUS_ICON = { pass: "✅", warn: "⚠️", fail: "❌", unknown: "•", skipped: "–" };

function fmt(value, unit = "") {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number") return String(value);
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded}${unit}`;
}

function unitFor(metric) {
  if (/Mb$/i.test(metric)) return " MB";
  if (/MbPerHour$/i.test(metric)) return " MB/h";
  if (/Ms$/i.test(metric)) return " ms";
  if (/^cpu|Cpu/.test(metric)) return " %";
  return "";
}

/** The conditions block every report opens with. */
export function platformTable(platform, configuration) {
  const rows = [
    ["OS", `${platform.osName ?? platform.os} ${platform.osVersion ?? ""}`.trim()],
    ["Architecture", platform.arch],
    ["Webview", platform.webview ?? "unknown"],
    ["CPU", `${platform.cpuModel ?? "unknown"} (${platform.cpuCores} logical cores)`],
    ["Memory", `${platform.totalMemMb} MB`],
    ["Power plan", platform.powerPlan ?? "—"],
    ["Build profile", configuration?.buildProfile ?? "unknown"],
    ["Machine", `\`${platform.hostId}\``],
  ];
  return ["| | |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

/** One scenario aggregate as a table of metrics. */
export function scenarioTable(aggregate) {
  const names = Object.keys(aggregate.metrics ?? {}).sort();
  if (names.length === 0) return "_no metrics recorded_";
  const head = ["| Metric | Median | Min | Max | Runs |", "|---|---:|---:|---:|---:|"];
  const rows = names.map((name) => {
    const m = aggregate.metrics[name];
    const u = unitFor(name);
    return `| \`${name}\` | ${fmt(m.median, u)} | ${fmt(m.min, u)} | ${fmt(m.max, u)} | ${m.n} |`;
  });
  return [...head, ...rows].join("\n");
}

/** The verdict's checks, so a warn or fail says which limit it crossed. */
export function verdictTable(verdict) {
  const checks = verdict?.checks ?? [];
  if (checks.length === 0) return "";
  const head = ["| | Check | Measured | Limit |", "|---|---|---:|---:|"];
  const rows = checks.map((c) => {
    const icon = STATUS_ICON[c.status] ?? "•";
    if ("before" in c) {
      const rel = c.relative === null || c.relative === undefined ? "—" : `${fmt(c.relative * 100)} %`;
      return `| ${icon} | \`${c.metric}\` vs baseline | ${fmt(c.before)} → ${fmt(c.after)} (${rel}) | ${fmt(c.relativeLimit * 100)} % + ${fmt(c.absoluteLimit)} |`;
    }
    return `| ${icon} | \`${c.metric}\` | ${fmt(c.measured, unitFor(c.metric))} | ${fmt(c.limit, unitFor(c.metric))} |`;
  });
  return [...head, ...rows].join("\n");
}

/**
 * Full report for a set of scenario aggregates.
 *
 * `scenarios` is the ordered list of `{ aggregate, scenario, verdict }`.
 */
export function renderReport({ scenarios, platform, configuration, commit, generatedAt }) {
  const out = [];
  out.push("# Resource benchmark report", "");
  out.push(
    `Commit \`${commit}\` · generated ${generatedAt} · ${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"}`,
    "",
  );
  out.push("## Conditions", "", platformTable(platform, configuration), "");
  out.push(
    "> Buckets are never summed. **own** is the app and its webview helpers, **managed** adds the shells and sidecars uxnan spawned, **external** is what the user ran inside them (an agent CLI, a build) and is reported for context only.",
    "",
    "> CPU figures are percent of **one** core. Divide by the core count above for a percent-of-machine reading.",
    "",
  );

  out.push("## Summary", "");
  out.push(
    "| Scenario | Verdict | own private | own working set | managed private | CPU P95 |",
    "|---|---|---:|---:|---:|---:|",
  );
  for (const s of scenarios) {
    const m = s.aggregate.metrics ?? {};
    out.push(
      `| **${s.aggregate.scenario}** ${s.scenario?.title ?? ""} | ${STATUS_ICON[s.verdict?.status] ?? "•"} ${s.verdict?.status ?? "unknown"} | ${fmt(m.ownPrivateP50Mb?.median, " MB")} | ${fmt(m.ownRssP50Mb?.median, " MB")} | ${fmt(m.managedPrivateP50Mb?.median, " MB")} | ${fmt(m.cpuP95?.median, " %")} |`,
    );
  }
  out.push(
    "",
    "> **private** sums private committed bytes (nothing double-counted) — the honest \"what does this cost me\". **working set** sums per-process working sets, which counts the pages the webview processes share once each, so it reads higher; it stays useful as a like-for-like signal between runs.",
    "",
  );

  for (const s of scenarios) {
    const a = s.aggregate;
    out.push(`## ${a.scenario} — ${s.scenario?.title ?? ""}`, "");
    if (s.scenario?.question) out.push(`*${s.scenario.question}*`, "");
    out.push(
      `Mode: **${s.scenario?.mode ?? "auto"}** · repetitions: **${a.repeats}** · verdict: **${s.verdict?.status ?? "unknown"}**`,
      "",
    );
    out.push(scenarioTable(a), "");
    const vt = verdictTable(s.verdict);
    if (vt) out.push("### Checks", "", vt, "");
    const notes = [...(a.notes ?? []), ...(s.verdict?.notes ?? [])];
    if (notes.length > 0) {
      out.push("### Notes", "", ...notes.map((n) => `- ${n}`), "");
    }
  }

  out.push("---", "");
  out.push(
    "Methodology, scenario definitions and the rules for promoting a baseline: [`docs/resource-benchmarks.md`](../docs/resource-benchmarks.md).",
    "",
  );
  return out.join("\n");
}
