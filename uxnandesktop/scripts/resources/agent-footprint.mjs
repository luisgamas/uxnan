#!/usr/bin/env node
/**
 * What one agent actually costs, measured — the evidence behind the global
 * agent budget's memory numbers (`orchestrationMinFreeMemoryMb`).
 *
 *   node scripts/resources/agent-footprint.mjs                  # every installed CLI
 *   node scripts/resources/agent-footprint.mjs --agent claude --repeats 5
 *
 * Those numbers say how much memory must be free before another agent may
 * start. Picked by intuition they are either useless (too low, and the machine
 * swaps) or costly (too high, and steps wait on a machine that was fine). So
 * they are derived from what an agent's **process tree** is actually seen
 * holding, on this machine, through the very path the app measures it with:
 * the headless runner's own sampler (`agentrun::watch_memory`), whose peak
 * lands in the run record.
 *
 * The method is deliberately the real one, not a simulation: a throwaway
 * profile, one automation per agent with a trivial prompt, the runner binary
 * executed exactly as the scheduler executes it. Nothing touches the operator's
 * profile (`UXNAN_DATA_DIR` points at the temp directory), and the run is over
 * in seconds because the prompt asks for a word.
 *
 * A result is one platform's. Windows and Linux need their own pass before the
 * presets can claim to be measured there — see `docs/resource-benchmarks.md`
 * and the platform matrix (plan 005).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { max, mean, percentile, round } from "./lib/stats.mjs";
import { settings } from "./lib/profile.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "../..");

/** The CLIs worth measuring, by the command the app launches. */
const CANDIDATES = ["claude", "codex", "opencode", "pi", "agy", "grok", "qwen", "kimi"];

/** A prompt whose answer is one word: this measures the CLI's footprint, not
 *  the model's patience. */
const PROMPT = "Reply with exactly the word: ok";

function parseArgs(argv) {
  const out = { agents: null, repeats: 3, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--agent") out.agents = (out.agents ?? []).concat(argv[++i]);
    else if (arg === "--repeats") out.repeats = Number(argv[++i]);
    else if (arg === "--keep") out.keep = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(out.repeats) || out.repeats < 1) {
    throw new Error("--repeats takes a positive integer");
  }
  return out;
}

/** Whether a command resolves on this machine's PATH. */
function installed(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [command], { stdio: "ignore" }).status === 0;
}

/** The debug or release runner binary, whichever exists (debug is what a
 *  developer has to hand; the footprint is the agent's, not the app's). */
function runnerBinary() {
  const name = process.platform === "win32" ? "uxnan-desktop.exe" : "uxnan-desktop";
  for (const profile of ["release", "debug"]) {
    const candidate = path.join(DESKTOP, "src-tauri/target", profile, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "no uxnan-desktop binary found — build one first (`cargo build` in src-tauri/)",
  );
}

/** Seed a throwaway profile holding one automation per agent. */
function seed(dir, agents) {
  fs.mkdirSync(path.join(dir, "automations"), { recursive: true });
  const now = Date.now();
  const automations = agents.map((agent) => ({
    id: `footprint-${agent}`,
    name: `Footprint ${agent}`,
    description: "One trivial step, to measure what the CLI holds.",
    enabled: true,
    tags: [],
    workingDir: dir,
    worktreePerRun: false,
    schedule: { kind: "dailyAt", hour: 4, minute: 0 },
    policy: { catchUp: false, overlap: "skip", maxRunMinutes: 10, keepRuns: 50 },
    steps: [
      {
        id: "s1",
        title: "Say ok",
        agent,
        model: "",
        prompt: PROMPT,
        dependsOn: [],
        onFailure: "stop",
        maxAttempts: 1,
        timeoutMs: 180_000,
        autonomous: false,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }));
  fs.writeFileSync(
    path.join(dir, "automations", "automations.json"),
    JSON.stringify({ version: 1, seededExamples: true, automations }, null, 2),
  );
  // The app's own persisted shape, with nothing that would poll or install.
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({ version: 2, repos: [], settings: settings() }),
  );
}

/** Run one automation once and return the peak its step recorded, in MiB. */
function measure(binary, dir, agent) {
  const runsDir = path.join(dir, "automations", "runs", `footprint-${agent}`);
  fs.rmSync(runsDir, { recursive: true, force: true });
  const env = { ...process.env, UXNAN_DATA_DIR: dir };
  for (const key of Object.keys(env)) {
    if (key.startsWith("UXNAN_") && key !== "UXNAN_DATA_DIR") delete env[key];
  }
  try {
    execFileSync(binary, ["--automation-run", `footprint-${agent}`, "--trigger", "manual"], {
      env,
      stdio: "ignore",
    });
  } catch {
    // A failed step exits 1 — a CLI that is installed but cannot run (no
    // credentials, no network) is a result to report, not a crash to throw.
    // The record below says which.
  }
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith(".json")) : [];
  if (files.length === 0) return { error: "the run left no record" };
  const run = JSON.parse(fs.readFileSync(path.join(runsDir, files[files.length - 1]), "utf8"));
  const step = run.steps?.[0];
  if (!step || step.status !== "completed") {
    return { error: step?.error ?? run.error ?? `step ${step?.status ?? "missing"}` };
  }
  return { peakMb: step.peakMemoryMb ?? 0, ms: (step.finishedAt ?? 0) - (step.startedAt ?? 0) };
}

/** The first line of an error, capped — enough to tell a missing credential
 *  from a missing binary without printing a provider's whole payload. */
function firstLine(text) {
  const line = String(text).split("\n")[0].trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
    return;
  }
  const wanted = args.agents ?? CANDIDATES;
  const agents = wanted.filter((a) => installed(a));
  const skipped = wanted.filter((a) => !agents.includes(a));
  if (agents.length === 0) throw new Error("none of the requested agents is installed");

  const binary = runnerBinary();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxnan-footprint-"));
  seed(dir, agents);

  console.log(`platform: ${process.platform} ${os.arch()} · ${os.cpus().length} cores · ` +
    `${round(os.totalmem() / 1024 ** 3, 1)} GB RAM`);
  console.log(`runner:   ${path.relative(DESKTOP, binary)}`);
  console.log(`repeats:  ${args.repeats}   prompt: ${JSON.stringify(PROMPT)}`);
  if (skipped.length > 0) console.log(`skipped (not installed): ${skipped.join(", ")}`);
  console.log("");

  const rows = [];
  for (const agent of agents) {
    const peaks = [];
    const errors = [];
    for (let i = 0; i < args.repeats; i += 1) {
      const result = measure(binary, dir, agent);
      if (result.error) errors.push(result.error);
      else peaks.push(result.peakMb);
    }
    rows.push({ agent, peaks, errors });
    const summary = peaks.length
      ? `peak ${max(peaks)} MB (mean ${round(mean(peaks))}, n=${peaks.length})`
      // A CLI that cannot run says why in one line: the whole provider error
      // (which can be a wall of JSON) belongs in the run record, not here.
      : `no measurement — ${firstLine(errors[0] ?? "unknown")}`;
    console.log(`  ${agent.padEnd(10)} ${summary}`);
  }

  const all = rows.flatMap((r) => r.peaks);
  if (all.length === 0) {
    console.log("\nnothing measured.");
    return;
  }
  const worst = max(all);
  console.log("");
  console.log(`across every measured run: max ${worst} MB, p95 ${round(percentile(all, 95))} MB`);
  console.log("");
  console.log("Reading it: the free-memory condition is how much room another");
  console.log("agent needs. The measured worst case above, with headroom for the");
  console.log("machine's own work, is the number — not a round figure picked for");
  console.log("looking careful. Balanced should sit near it; Efficient higher (it");
  console.log("yields the machine sooner), Performance lower.");
  if (!args.keep) fs.rmSync(dir, { recursive: true, force: true });
  else console.log(`\nprofile kept at ${dir}`);
}

main();
