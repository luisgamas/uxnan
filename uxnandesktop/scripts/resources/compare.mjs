#!/usr/bin/env node
/**
 * Compare a candidate run against an approved baseline.
 *
 *   node scripts/resources/compare.mjs --baseline baselines/windows --candidate .resource-results
 *
 * This is the check that actually catches drift: absolute budgets say "still
 * under the ceiling", a comparison says "this change made it worse". It is
 * deliberately hard to trip — a metric has to move by both a relative and an
 * absolute margin — because a gate that fires on noise gets switched off, and
 * then nothing is measured at all.
 *
 * Exit code: 0 for pass/warn/unknown, 1 for fail. Failing only happens once the
 * platform's budget file leaves `mode: "warn"`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_REGRESSION_POLICY, evaluateRegression } from "./lib/budgets.mjs";
import { verdictTable } from "./lib/markdown.mjs";
import { worstOf } from "./lib/schema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..", "..");

function parseArgs(argv) {
  const args = {
    baseline: path.join(HERE, "baselines"),
    candidate: path.join(DESKTOP_ROOT, ".resource-results"),
    file: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--baseline") args.baseline = path.resolve(argv[++i]);
    else if (argv[i] === "--candidate") args.candidate = path.resolve(argv[++i]);
    else if (argv[i] === "--file") args.file = path.resolve(argv[++i]);
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

/** Load `{ scenarioName: aggregate }` from a directory of aggregate files. */
function loadAggregates(dir) {
  const root = fs.existsSync(path.join(dir, "aggregates")) ? path.join(dir, "aggregates") : dir;
  if (!fs.existsSync(root)) return {};
  const out = {};
  for (const f of fs.readdirSync(root)) {
    if (!f.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
      if (doc?.scenario) out[path.basename(f, ".json")] = doc;
    } catch {
      /* a malformed file is reported by its absence below */
    }
  }
  return out;
}

function loadBudget(osKey, baselineDir) {
  for (const c of [
    path.join(baselineDir, `budget-${osKey}.json`),
    path.join(HERE, "budgets", `${osKey}.json`),
  ]) {
    if (fs.existsSync(c)) {
      try {
        return JSON.parse(fs.readFileSync(c, "utf8"));
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "node scripts/resources/compare.mjs --baseline <dir> --candidate <dir> [--file <out.md>]\n",
    );
    return 0;
  }

  const baseline = loadAggregates(args.baseline);
  const candidate = loadAggregates(args.candidate);
  const names = Object.keys(candidate).sort();

  if (names.length === 0) {
    process.stderr.write(`no candidate aggregates found in ${args.candidate}\n`);
    return 1;
  }

  const lines = ["# Resource comparison", ""];
  const statuses = [];

  for (const name of names) {
    const cand = candidate[name];
    const base = baseline[name] ?? null;
    const budget = loadBudget(cand.platform?.os, args.baseline);
    const verdict = evaluateRegression(base, cand, DEFAULT_REGRESSION_POLICY, budget?.mode);
    statuses.push(verdict.status);

    lines.push(`## ${name} — ${verdict.status}`, "");
    if (verdict.notes.length > 0) lines.push(...verdict.notes.map((n) => `> ${n}`), "");
    const table = verdictTable(verdict);
    if (table) lines.push(table, "");
  }

  const overall = worstOf(statuses);
  lines.splice(2, 0, `**Overall: ${overall}**`, "");
  const markdown = lines.join("\n");

  if (args.file) {
    fs.mkdirSync(path.dirname(args.file), { recursive: true });
    fs.writeFileSync(args.file, markdown, "utf8");
  }
  process.stdout.write(markdown);
  process.stdout.write("\n");
  return overall === "fail" ? 1 : 0;
}

process.exit(main());
