#!/usr/bin/env node
/**
 * Run resource scenarios and write result documents.
 *
 *   node scripts/resources/run.mjs --scenario R01
 *   node scripts/resources/run.mjs --all --repeats 5
 *   node scripts/resources/run.mjs --scenario R09 --variant overlay
 *
 * Everything it writes goes under `--out` (default `.resource-results/`, which is
 * git-ignored). It never touches the real application profile: each repetition
 * gets a freshly-seeded one inside that directory and the app is pointed at it
 * with `UXNAN_DATA_DIR`.
 *
 * Full documentation: `uxnandesktop/docs/resource-benchmarks.md`.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findBinary, launchApp } from "./lib/app.mjs";
import { Sampler, sleep, snapshotPids } from "./lib/sampler.mjs";
import { readPlatform } from "./lib/platform.mjs";
import { liveTerminalCount, writeProfile } from "./lib/profile.mjs";
import { autoScenarioIds, getScenario, SCENARIOS } from "./lib/scenarios.mjs";
import { aggregateRepeats, newRun, summarizeRun, validateRun } from "./lib/schema.mjs";
import { classifyTree, findOrphans } from "./lib/tree.mjs";
import { findLeaks, redact } from "./lib/redact.mjs";
import { combineVerdicts, evaluateBudget } from "./lib/budgets.mjs";
import {
  checkBinaryEmbedsFrontend,
  checkExpectedShells,
  checkNoForeignInstance,
  checkWebviewInTree,
  waitForExit,
} from "./lib/preflight.mjs";
import { makeRepo } from "./fixtures/make-repo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..", "..");

// --- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const args = {
    scenario: null,
    all: false,
    repeats: 5,
    duration: null,
    stabilize: null,
    interval: null,
    variant: null,
    out: path.join(DESKTOP_ROOT, ".resource-results"),
    binary: null,
    buildProfile: "release",
    assisted: false,
    keepSamples: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    switch (a) {
      case "--scenario": args.scenario = next(); break;
      case "--all": args.all = true; break;
      case "--repeats": args.repeats = Number(next()); break;
      case "--duration": args.duration = Number(next()); break;
      case "--stabilize": args.stabilize = Number(next()); break;
      case "--interval": args.interval = Number(next()); break;
      case "--variant": args.variant = next(); break;
      case "--out": args.out = path.resolve(next()); break;
      case "--binary": args.binary = path.resolve(next()); break;
      case "--profile": args.buildProfile = next(); break;
      case "--assisted": args.assisted = true; break;
      case "--no-samples": args.keepSamples = false; break;
      case "--help":
      case "-h": args.help = true; break;
      default:
        throw new Error(`unknown argument ${a} (try --help)`);
    }
  }
  return args;
}

function usage() {
  const list = SCENARIOS.map((s) => `    ${s.id}  ${s.mode.padEnd(8)} ${s.title}`).join("\n");
  return `Uxnan desktop resource benchmarks

  node scripts/resources/run.mjs --scenario <id> [options]
  node scripts/resources/run.mjs --all [options]

Options
  --scenario <id>     one scenario (see below)
  --all               every unattended scenario
  --repeats <n>       repetitions per scenario (default 5)
  --duration <s>      override the measurement window
  --stabilize <s>     override the discarded warm-up window
  --interval <ms>     sampling interval (default 1000)
  --variant <name>    scenario variant (R09: off | layer | overlay; R12: off | parked | sweep)
  --out <dir>         results directory (default .resource-results)
  --binary <path>     app binary to measure (default: the release build)
  --profile <name>    build profile recorded in the result (default release)
  --assisted          also run scenarios that need an operator at the keyboard
  --no-samples        drop the raw samples from the written document

Scenarios
${list}
`;
}

// --- fixtures ---------------------------------------------------------------

/** Build (or reuse) the fixtures a scenario declares. Shared across repetitions:
 *  regenerating 10 000 files per repetition would measure the generator. */
function prepareFixtures(scenario, outDir) {
  const built = {};
  const spec = scenario.fixtures ?? {};
  if (spec.repo) {
    const dir = path.join(outDir, "fixtures", `repo-${spec.repo.name}`);
    built.repo = makeRepo({ ...spec.repo, dir });
  }
  if (spec.http) {
    built.http = startHttpFixture(spec.http);
  }
  return built;
}

function startHttpFixture({ weight = "light" }) {
  const child = spawn(
    process.execPath,
    [path.join(HERE, "fixtures", "http-server.mjs"), "--weight", weight],
    { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
  );
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: child.stdout });
    rl.once("line", (line) => {
      let url = null;
      try {
        url = JSON.parse(line).url;
      } catch {
        /* leave null */
      }
      resolve({ url, stop: () => child.kill() });
    });
  });
}

// --- one repetition ---------------------------------------------------------

async function runOnce({ scenario, rep, args, platform, commit, binary, fixtures, outDir }) {
  const label = `${scenario.id}${args.variant ? `-${args.variant}` : ""}-r${rep + 1}`;
  const workDir = path.join(outDir, "work", label);
  // Only ever inside our own output directory — the harness must not be able to
  // delete anything a mistyped flag could point it at.
  if (!workDir.startsWith(path.join(outDir, "work"))) {
    throw new Error(`refusing to prepare a work directory outside ${outDir}`);
  }
  fs.rmSync(workDir, { recursive: true, force: true });
  const dataDir = path.join(workDir, "data");

  const prepared = scenario.prepare({ fixtures, variant: args.variant, workDir });
  writeProfile(dataDir, prepared);
  const expectedShells = liveTerminalCount(prepared.layout);

  const durationS = args.duration ?? scenario.defaults.durationS;
  const stabilizeS = args.stabilize ?? scenario.defaults.stabilizeS;
  const intervalMs = args.interval ?? scenario.defaults.intervalMs ?? 1000;

  const doc = newRun({
    scenario: scenario.id,
    commit,
    platform,
    configuration: {
      buildProfile: args.buildProfile,
      variant: args.variant ?? null,
      durationS,
      stabilizeS,
      intervalMs,
      repetition: rep + 1,
      mode: scenario.mode,
    },
  });
  doc.notes.push(...(prepared.notes ?? []));

  // A restore is only a restore if the profile has been lived in: launch once,
  // let it settle, close it, and measure the launch that comes after.
  if (scenario.warmup) {
    const warm = launchApp(binary, { dataDir });
    await warm.waitForBackend(120_000);
    await sleep(8000);
    await warm.quit();
    await sleep(2000);
    doc.notes.push("a warm-up launch wrote the session this run restores");
  }

  process.stderr.write(`  ${label}: launching…\n`);
  const startedAt = Date.now();
  const app = launchApp(binary, { dataDir });
  const sampler = new Sampler(app.pid, { intervalMs });
  // "A restored terminal is live" is observed as the first managed process
  // beside the app itself. Only meaningful where the scenario actually seeded a
  // terminal: with none, the first managed process is whatever uxnan happened to
  // spawn on its own (a git call, a CLI-detection probe), and calling that
  // `launchToShell` would publish a confident answer to a question nobody asked.
  let shellReadyMs = null;
  if (expectedShells > 0) {
    sampler.onSample = (sample) => {
      if (shellReadyMs === null && sample.managed.procs > sample.own.procs) {
        shellReadyMs = Date.now() - startedAt;
      }
    };
  }
  sampler.start();

  const [windowMs, backendMs] = await Promise.all([
    app.waitForWindow(120_000),
    app.waitForBackend(120_000),
  ]);
  if (windowMs !== null) doc.phases.push({ name: "launchToWindow", atMs: windowMs });
  if (backendMs !== null) doc.phases.push({ name: "launchToBackend", atMs: backendMs });
  else doc.notes.push("the hook server never wrote its endpoint file within the timeout");

  if (app.exited) {
    sampler.stop();
    doc.notes.push(`the app exited during launch (code ${app.exitCode})`);
    doc.verdict = { status: "fail", budgetVersion: null, checks: [] };
    return { doc, label };
  }

  const checklist = scenario.checklist ?? [];
  if (checklist.length > 0) {
    process.stderr.write(`\n  Operator checklist for ${scenario.id}:\n`);
    checklist.forEach((step, i) => process.stderr.write(`    ${i + 1}. ${step}\n`));
    if (fixtures.http?.url) process.stderr.write(`    fixture page: ${fixtures.http.url}\n`);
    process.stderr.write(`  (measuring for ${durationS}s)\n\n`);
  }

  await sleep(durationS * 1000);
  if (shellReadyMs !== null) doc.phases.push({ name: "launchToShell", atMs: shellReadyMs });

  // Snapshot the tree before asking the app to close, so we know which PIDs we
  // were responsible for when we look for survivors.
  const lastRows = sampler.lastRows;
  const managedPids = [...classifyTree(lastRows, app.pid).keys()];
  const quit = await app.quit();
  doc.phases.push({ name: "close", atMs: quit.closeMs ?? 0 });
  if (quit.forced) doc.notes.push("the app had to be force-killed: it did not close on request");
  sampler.stop();

  // Wait for the tree to actually go away before calling anything an orphan.
  // This is also what stops the next repetition from adopting a webview browser
  // process this one left behind (see `preflight.mjs`).
  const survivors = await waitForExit(managedPids, { timeoutMs: 20_000 });
  doc.orphans = findOrphans(lastRows, app.pid, snapshotPids(survivors));

  doc.durationMs = Date.now() - startedAt;
  doc.processes = {
    atEnd: [...new Set(lastRows.map((r) => r.name))].sort(),
  };
  if (sampler.droppedLines > 0) {
    doc.notes.push(`${sampler.droppedLines} collector line(s) were unparseable and skipped`);
  }
  if (sampler.samples.length === 0) {
    doc.notes.push("the collector produced no samples — check that it can run on this machine");
  }
  // Two ways a run can look excellent and mean nothing: the webview landing
  // outside the tree, and the seeded session never coming back. Both are
  // invalid runs, not good ones.
  for (const problem of [
    checkWebviewInTree(sampler.samples),
    checkExpectedShells(sampler.samples, expectedShells),
  ]) {
    if (problem) {
      doc.notes.push(problem);
      doc.invalid = true;
    }
  }
  doc.samples = sampler.samples;
  doc.summary = summarizeRun(doc, { stableFromMs: stabilizeS * 1000 });
  if (!args.keepSamples) doc.samples = [];

  return { doc, label };
}

// --- scenario driver --------------------------------------------------------

async function runScenario(scenario, args, ctx) {
  process.stderr.write(`\n${scenario.id} — ${scenario.title} (${scenario.mode})\n`);
  const fixtures = prepareFixtures(scenario, args.out);
  if (fixtures.http instanceof Promise) fixtures.http = await fixtures.http;

  const runs = [];
  try {
    for (let rep = 0; rep < args.repeats; rep += 1) {
      const { doc, label } = await runOnce({
        scenario,
        rep,
        args,
        fixtures,
        outDir: args.out,
        ...ctx,
      });

      const budget = loadBudget(ctx.platform.os, args.out);
      const partial = aggregateRepeats([doc]);
      doc.verdict = doc.invalid
        ? { status: "fail", budgetVersion: null, checks: [], notes: ["invalid run — see notes"] }
        : combineVerdicts(evaluateBudget(partial, budget));

      const check = validateRun(doc);
      if (!check.ok) {
        process.stderr.write(`  ${label}: invalid result document:\n`);
        for (const e of check.errors) process.stderr.write(`    - ${e}\n`);
      }
      writeResult(path.join(args.out, "runs", `${label}.json`), doc);
      const s = doc.summary ?? {};
      process.stderr.write(
        `  ${label}: own ${fmtMb(s.ownPrivateP50Mb)} private / ${fmtMb(s.ownRssP50Mb)} ws · managed ${fmtMb(s.managedPrivateP50Mb)} private · cpu P95 ${s.cpuP95 ?? "—"}% · orphans ${doc.orphans.length}\n`,
      );
      runs.push(doc);
    }
  } finally {
    fixtures.http?.stop?.();
  }

  const aggregate = aggregateRepeats(runs);
  const budget = loadBudget(ctx.platform.os, args.out);
  const verdict = combineVerdicts(evaluateBudget(aggregate, budget));
  aggregate.verdict = verdict.status;
  const name = `${scenario.id}${args.variant ? `-${args.variant}` : ""}`;
  writeResult(path.join(args.out, "aggregates", `${name}.json`), aggregate);
  return { aggregate, scenario, verdict };
}

function fmtMb(v) {
  return v === null || v === undefined ? "—" : `${v} MB`;
}

/** Budgets ship in the repo; a local override in the results dir is allowed so
 *  an operator can experiment without editing tracked files. */
function loadBudget(osKey, outDir) {
  const candidates = [
    path.join(outDir, "budgets", `${osKey}.json`),
    path.join(HERE, "budgets", `${osKey}.json`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return JSON.parse(fs.readFileSync(c, "utf8"));
      } catch (err) {
        process.stderr.write(`  budget file ${c} is not valid JSON: ${err.message}\n`);
      }
    }
  }
  return null;
}

/** Write a document after scrubbing it, refusing if anything personal survived. */
function writeResult(file, doc) {
  const clean = redact(doc);
  const leaks = findLeaks(clean);
  if (leaks.length > 0) {
    throw new Error(
      `refusing to write ${path.basename(file)}: ${leaks.length} value(s) still look personal, first is ${JSON.stringify(leaks[0]).slice(0, 120)}`,
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(clean, null, 2), "utf8");
}

// --- entry point ------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.scenario && !args.all)) {
    process.stdout.write(usage());
    return 0;
  }

  const ids = args.all ? autoScenarioIds() : [args.scenario];
  const scenarios = ids.map(getScenario);
  const skipped = scenarios.filter((s) => s.mode === "assisted" && !args.assisted);
  const runnable = scenarios.filter((s) => s.mode !== "assisted" || args.assisted);

  const binary = findBinary({
    root: DESKTOP_ROOT,
    profile: args.buildProfile,
    explicit: args.binary,
  });
  for (const blocker of [checkBinaryEmbedsFrontend(binary), checkNoForeignInstance(binary)]) {
    if (blocker) {
      process.stderr.write(`\n${blocker}\n`);
      return 2;
    }
  }

  const platform = readPlatform();
  const commit = readCommit();

  process.stderr.write(
    `binary: ${path.basename(binary)} (${args.buildProfile}) · commit ${commit} · ${platform.os}/${platform.arch}\n`,
  );
  if (skipped.length > 0) {
    process.stderr.write(
      `skipping operator-driven scenario(s): ${skipped.map((s) => s.id).join(", ")} (pass --assisted to include them)\n`,
    );
  }

  const results = [];
  for (const scenario of runnable) {
    results.push(await runScenario(scenario, args, { platform, commit, binary }));
  }

  process.stderr.write("\nresults written to ");
  process.stderr.write(`${args.out}\n`);
  process.stderr.write("build a report with:  node scripts/resources/report.mjs\n");

  return results.some((r) => r.verdict.status === "fail") ? 1 : 0;
}

function readCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: DESKTOP_ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "unknown";
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`\n${err?.message ?? err}\n`);
    process.exit(1);
  },
);
