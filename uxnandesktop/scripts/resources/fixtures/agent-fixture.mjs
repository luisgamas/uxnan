#!/usr/bin/env node
/**
 * A stand-in for a coding agent, so the "agent working" scenario is measurable.
 *
 * Running a real CLI here would be wrong twice over: its cost varies with a
 * model, a network and an account (so the run would not be reproducible), and CI
 * must never be handed credentials to make that happen. What the benchmark
 * actually needs from an agent is the *shape* of the load it puts on the app —
 * a stream of terminal output, periods of silence, a state change — and that is
 * exactly what this produces, at a fixed rate, offline.
 *
 * The phases mirror what the agent monitor infers from a real session:
 *
 *   working → output at `--rate` lines/second
 *   waiting → silence (a prompt the user has to answer)
 *   working → output again
 *   done    → a final line, then exit 0
 *
 * With `--hooks` it also reports each transition to the local hook server the
 * way a real reporter does, using only the `UXNAN_*` variables the app injected
 * into this terminal, so the Layer 1 path is exercised too. Without them it
 * simply skips reporting — never an error, never a hang.
 *
 * Usage:
 *   node agent-fixture.mjs [--rate 20] [--work 20] [--wait 10] [--hooks]
 */

import process from "node:process";

const argv = process.argv.slice(2);
const num = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const RATE = num("rate", 20); // lines per second
const WORK_S = num("work", 20); // seconds per working phase
const WAIT_S = num("wait", 10); // seconds of the waiting phase
const HOOKS = argv.includes("--hooks");

const LINE =
  "· reading src/lib/state/terminals.svelte.ts … 1284 lines, 42 symbols, 3 references resolved";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Report a state to the app's hook server, if this terminal has one. */
async function report(state, extra = {}) {
  if (!HOOKS) return;
  const url = process.env.UXNAN_HOOK_URL;
  const token = process.env.UXNAN_HOOK_TOKEN;
  const agentId = process.env.UXNAN_AGENT_ID;
  if (!url || !token || !agentId) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Uxnan-Token": token },
      body: JSON.stringify({ agentId, agent: "fixture", state, ...extra }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // A benchmark fixture never fails the run because reporting failed.
  }
}

async function emit(seconds, rate) {
  const intervalMs = Math.max(1, Math.round(1000 / rate));
  const until = Date.now() + seconds * 1000;
  let n = 0;
  while (Date.now() < until) {
    process.stdout.write(`${String(n).padStart(6, "0")} ${LINE}\n`);
    n += 1;
    await sleep(intervalMs);
  }
  return n;
}

async function main() {
  process.stdout.write("uxnan resource fixture agent — deterministic load, no network\n");

  await report("working", { prompt: "benchmark fixture", tool: "read" });
  const first = await emit(WORK_S, RATE);

  await report("waiting", { summary: "waiting for input" });
  process.stdout.write("\n? Continue with the plan? (this fixture answers itself)\n");
  await sleep(WAIT_S * 1000);

  await report("working", { tool: "edit" });
  const second = await emit(WORK_S, RATE);

  await report("done", { summary: "fixture run complete" });
  process.stdout.write(`\nfixture complete — ${first + second} lines emitted\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`fixture failed: ${err?.message ?? err}\n`);
    process.exit(1);
  },
);
