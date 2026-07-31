#!/usr/bin/env node
/**
 * A stand-in for the `gh` CLI.
 *
 * Every GitHub feature in the app shells out to `gh`. Testing them against the
 * real one would mean a network, an account, rate limits and — for anything that
 * writes — actual pull requests on somebody's repository. So the tests get this:
 * the same argument surface, deterministic answers, no network.
 *
 * **It refuses to run unless `UXNAN_FIXTURE_GH=1` is set.** That is the whole
 * safety story. A test harness that silently fell through to the real `gh` on a
 * developer's machine would pass locally, do real things, and fail in CI for
 * reasons nobody could reproduce — so the fake would rather fail loudly than be
 * mistaken for the real thing, and the real thing can never be mistaken for it.
 *
 * Behaviour is steered entirely by environment variables, so a test configures
 * it without writing files:
 *
 *   UXNAN_FIXTURE_GH=1              required; the safety latch
 *   UXNAN_FIXTURE_GH_LOG=<path>     append one JSON line per invocation
 *   UXNAN_FIXTURE_GH_FAIL=<code>    exit with this code and a plausible error
 *   UXNAN_FIXTURE_GH_DELAY_MS=<n>   stall before answering (timeout tests)
 *   UXNAN_FIXTURE_GH_RESPONSES=<path>  JSON map of "<subcommand>" → payload
 *
 * A payload is normally the stdout to answer with (a string, or JSON to
 * stringify). It can also be a full **outcome** — `{"$outcome": {"exit": 1,
 * "stdout": "…", "stderr": "…"}}` — which is how a test scripts a real gh
 * *failure* shape (a blocked merge, a logged-out read) rather than just a
 * success body. The canonical failure shapes live in
 * `tests/fixtures/github/mutation-outcomes.json`, each with its provenance.
 *
 * Arguments are logged, tokens are not: anything that looks like a credential is
 * replaced before it reaches the log, because a fixture that records secrets is
 * a fixture that eventually commits one.
 */

import fs from "node:fs";

const argv = process.argv.slice(2);

if (process.env.UXNAN_FIXTURE_GH !== "1") {
  process.stderr.write(
    "fake-gh: refusing to run without UXNAN_FIXTURE_GH=1.\n" +
      "This is the test double for the gh CLI. If you meant the real gh, it is not on PATH here;\n" +
      "if you meant this one, set the variable — the latch exists so a test can never quietly\n" +
      "reach the real GitHub.\n",
  );
  process.exit(64);
}

/** Redact anything credential-shaped before it is written anywhere. */
function scrub(value) {
  return String(value)
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, "<token>")
    .replace(/(--?(?:token|password|secret)[= ])\S+/gi, "$1<redacted>")
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>");
}

const logPath = process.env.UXNAN_FIXTURE_GH_LOG;
if (logPath) {
  const line = JSON.stringify({ argv: argv.map(scrub) });
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

const delay = Number(process.env.UXNAN_FIXTURE_GH_DELAY_MS ?? 0);

/** Canned answers, keyed by the leading subcommand path ("pr list", "auth status"). */
function responses() {
  const file = process.env.UXNAN_FIXTURE_GH_RESPONSES;
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Longest matching prefix of the *subcommand* path, so "pr list" beats "pr".
 *
 * Flags are skipped when building that path — `gh pr list --limit 5` is still
 * "pr list". The bare flags that are commands in their own right (`--version`,
 * `--help`) are matched first, since they have no subcommand at all.
 */
function pick(table) {
  for (const flag of ["--version", "--help"]) {
    if (argv.includes(flag) && flag in table) return table[flag];
  }
  const positional = argv.filter((a) => !a.startsWith("-"));
  for (let n = Math.min(positional.length, 3); n > 0; n -= 1) {
    const key = positional.slice(0, n).join(" ");
    if (key in table) return table[key];
  }
  return undefined;
}

/** Answers that make the app's happy paths work with no configuration. */
const DEFAULTS = {
  "--version": "gh version 2.0.0-uxnan-fixture (fake)\n",
  // `auth status --json hosts` (the structured probe the app tries first):
  // `hosts` is a *positional* to the matcher since `--json` is a flag, so the
  // three-word key answers the JSON form and the two-word key the prose one.
  "auth status hosts": JSON.stringify({
    hosts: {
      "github.com": [
        {
          state: "success",
          active: true,
          host: "github.com",
          login: "fixture-user",
          tokenSource: "keyring",
          scopes: "repo, read:org",
          gitProtocol: "https",
        },
      ],
    },
  }),
  "auth status": "github.com\n  ✓ Logged in to github.com account fixture-user (keyring)\n  - Token scopes: 'repo', 'read:org'\n",
  "api rate_limit": JSON.stringify({
    resources: { core: { limit: 5000, remaining: 4987, reset: 0 } },
  }),
  "pr list": JSON.stringify([]),
  "issue list": JSON.stringify([]),
  "run list": JSON.stringify([]),
};

async function main() {
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  const failCode = Number(process.env.UXNAN_FIXTURE_GH_FAIL ?? 0);
  if (failCode > 0) {
    // Shaped like a real gh failure so the app's error handling is exercised,
    // not just its success path.
    process.stderr.write("gh: could not complete the request (fixture failure)\n");
    process.exit(failCode);
  }

  const answer = pick({ ...DEFAULTS, ...responses() });
  if (answer === undefined) {
    process.stderr.write(
      `fake-gh: no canned response for "${argv.join(" ")}".\n` +
        "Add one via UXNAN_FIXTURE_GH_RESPONSES so the test states what it expects.\n",
    );
    process.exit(65);
  }

  // A scripted outcome: stdout + stderr + exit code, the way the real gh
  // shapes a refusal. Anything else is a plain success payload.
  if (answer !== null && typeof answer === "object" && "$outcome" in answer) {
    const outcome = answer.$outcome ?? {};
    if (outcome.stdout) process.stdout.write(outcome.stdout);
    if (outcome.stderr) process.stderr.write(outcome.stderr);
    process.exit(Number(outcome.exit ?? 0));
  }

  process.stdout.write(typeof answer === "string" ? answer : `${JSON.stringify(answer)}\n`);
}

main().catch((err) => {
  process.stderr.write(`fake-gh: ${err?.message ?? err}\n`);
  process.exit(70);
});
