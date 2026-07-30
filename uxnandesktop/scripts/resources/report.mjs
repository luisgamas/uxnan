#!/usr/bin/env node
/**
 * Render the Markdown report for a results directory.
 *
 *   node scripts/resources/report.mjs [--out .resource-results] [--file report.md]
 *
 * Reads the per-scenario aggregates `run.mjs` wrote and produces the document a
 * human reads before believing any of it. Prints to stdout as well, so it can be
 * piped into a PR comment.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderReport } from "./lib/markdown.mjs";
import { SCENARIOS } from "./lib/scenarios.mjs";
import { evaluateBudget } from "./lib/budgets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..", "..");

function parseArgs(argv) {
  const args = {
    out: path.join(DESKTOP_ROOT, ".resource-results"),
    file: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = path.resolve(argv[++i]);
    else if (argv[i] === "--file") args.file = path.resolve(argv[++i]);
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  args.file ??= path.join(args.out, "report.md");
  return args;
}

/** The platform's committed budget, or `null` (which reads as `unknown`). */
function loadBudget(osKey) {
  if (!osKey) return null;
  const file = path.join(HERE, "budgets", `${osKey}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "node scripts/resources/report.mjs [--out <results dir>] [--file <report.md>]\n",
    );
    return 0;
  }

  const dir = path.join(args.out, "aggregates");
  if (!fs.existsSync(dir)) {
    process.stderr.write(`no aggregates in ${dir} — run scripts/resources/run.mjs first\n`);
    return 1;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    process.stderr.write(`no aggregates in ${dir} — run scripts/resources/run.mjs first\n`);
    return 1;
  }

  const scenarios = files.map((f) => {
    const aggregate = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const definition = SCENARIOS.find((s) => s.id === aggregate.scenario) ?? null;
    // A variant is a separate result with its own budget entry, so it is keyed
    // and titled by the file name ("R09-overlay"), not by the scenario id —
    // three rows all reading "Pet companion" would be unreadable.
    const key = path.basename(f, ".json");
    const variant = aggregate.configuration?.variant;
    // Judge against the budget **in the tree now**, not the one that happened to
    // exist when the run was recorded: a stored verdict goes stale the moment a
    // limit moves, and a stale pass is worse than no pass.
    const verdict = evaluateBudget({ ...aggregate, scenario: key }, loadBudget(aggregate.platform?.os));
    return {
      aggregate: { ...aggregate, scenario: key },
      scenario: definition
        ? { ...definition, title: variant ? `${definition.title} (${variant})` : definition.title }
        : null,
      verdict,
    };
  });

  const first = scenarios[0].aggregate;
  const markdown = renderReport({
    scenarios,
    platform: first.platform,
    configuration: first.configuration,
    commit: first.commit,
    generatedAt: new Date().toISOString(),
  });

  fs.mkdirSync(path.dirname(args.file), { recursive: true });
  fs.writeFileSync(args.file, markdown, "utf8");
  process.stdout.write(markdown);
  process.stderr.write(`\nwritten to ${args.file}\n`);
  return 0;
}

process.exit(main());
