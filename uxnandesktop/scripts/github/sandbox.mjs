#!/usr/bin/env node
/**
 * The GitHub **sandbox harness**: builds, inspects, protects and cleans the one
 * disposable repository the live validation suite (`src-tauri/tests/github_live.rs`)
 * is allowed to mutate.
 *
 * ## Safety model (read before running)
 *
 * - **Dry-run is the default.** Every command prints its exact plan — each `gh`
 *   invocation and the read that will verify its outcome — and touches nothing.
 *   Only `--execute` performs the plan, and the first execution of each
 *   destructive action is meant to be **supervised** (a human watching the
 *   output against `docs/github-sandbox-runbook.md`).
 * - **Exact allowlist.** The target must arrive as `UXNAN_GH_SANDBOX` and equal
 *   `luisgamas/uxnan-gh-sandbox` exactly (`requireSandbox`). The production
 *   repository is refused by name on top of that. There is no default target.
 * - **Marker double-check.** Beyond the name, an executing run re-reads the
 *   repository and requires the `uxnan-gh-sandbox` topic `setup` stamps on it
 *   before mutating (setup itself requires the repo to not exist yet, or to
 *   already carry the marker). Two locks, independently verified.
 * - **Every mutation argv names the sandbox explicitly** (`-R owner/repo` or a
 *   `repos/owner/repo/…` path) and is re-checked against the allowlist at spawn
 *   time — a step that somehow targeted anything else refuses to run.
 * - **Failure artifact.** If an executing run fails, the surviving state
 *   (sanitized ids only) is written to `scripts/github/.sandbox-failure.json`
 *   and **every later `--execute` run refuses to start** until a human has
 *   looked, cleaned up (usually `cleanup --execute`) and deleted that file.
 * - **No token anywhere.** `gh` owns authentication; this script never reads,
 *   stores or prints one.
 *
 * ## Commands
 *
 * ```
 * node scripts/github/sandbox.mjs status              # read-only report
 * node scripts/github/sandbox.mjs setup [--execute]   # create + seed the sandbox
 * node scripts/github/sandbox.mjs protect [--execute] # apply the main ruleset
 * node scripts/github/sandbox.mjs unprotect [--execute]
 * node scripts/github/sandbox.mjs cleanup [--execute] [--delete-repo]
 * ```
 *
 * The sandbox is **public** on purpose: on a free account, rulesets are only
 * *enforced* on public repositories — a private sandbox would validate nothing
 * about branch protection.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_REPOS,
  SANDBOX_TOPIC,
  redactArgvForLog,
  requireSandbox,
  scrubSecrets,
} from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Where a failed execute run records its survivors (and blocks the next one).
 *  Overridable only so the harness's own tests can exercise the block without
 *  planting files in the repository; it never weakens the allowlist. */
const FAILURE_ARTIFACT =
  process.env.UXNAN_GH_SANDBOX_STATE ?? path.join(HERE, ".sandbox-failure.json");

/** The ruleset `protect` applies — mirrors the production repo's shape (1
 *  review, thread resolution, merge+squash only) so what blocks there blocks
 *  here. Named so `unprotect` can find exactly ours and nothing else. */
const RULESET_NAME = "uxnan-sandbox-ruleset";

/** The innocuous, always-cancelable workflow `setup` commits: it only sleeps,
 *  runs solely on manual dispatch, and gives run-cancel a guaranteed target. */
const SLEEP_WORKFLOW = `# Innocuous fixture workflow for the uxnan live validation suite.
# Dispatch-only, does nothing but sleep, exists to be listed and cancelled.
name: sleep
on:
  workflow_dispatch:
permissions: {}
jobs:
  sleep:
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - name: Sleep so a cancel always has a target
        run: sleep 600
`;

// ---------------------------------------------------------------------------
// gh runners (this file owns the ONLY mutation path in scripts/github/)
// ---------------------------------------------------------------------------

/** Read-only gh (throws on non-zero exit). */
function read(argv) {
  return execFileSync("gh", argv, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_PAGER: "", PAGER: "" },
  }).trim();
}

/** Like {@link read} but returns null instead of throwing (existence probes). */
function tryRead(argv) {
  try {
    return read(argv);
  } catch {
    return null;
  }
}

/**
 * Run one **mutating** gh invocation, in execute mode only, after re-verifying
 * the argv can only touch the sandbox: it must reference the allowlisted repo
 * explicitly and may never reference a forbidden one.
 */
function mutate(sandbox, argv, { input } = {}) {
  const flat = argv.join(" ");
  for (const forbidden of FORBIDDEN_REPOS) {
    // Guard against both `owner/repo` and `repos/owner/repo` spellings, but
    // don't trip on the sandbox's own name containing the production name as a
    // substring — compare on boundaries.
    const re = new RegExp(`(^|[\\s/])${forbidden.replace(/[/.]/g, "\\$&")}([\\s/.]|$)`);
    if (re.test(flat)) {
      throw new Error(`refusing to run "gh ${flat}": it references ${forbidden}`);
    }
  }
  if (!flat.includes(sandbox.nameWithOwner)) {
    throw new Error(
      `refusing to run "gh ${flat}": a sandbox mutation must name ${sandbox.nameWithOwner} explicitly`,
    );
  }
  process.stdout.write(`  $ gh ${redactArgvForLog(argv).join(" ")}\n`);
  return execFileSync("gh", argv, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    input,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_PAGER: "", PAGER: "" },
  }).trim();
}

// ---------------------------------------------------------------------------
// plan machinery — dry-run prints it, execute performs it
// ---------------------------------------------------------------------------

/**
 * A step: what will run, why, and how its outcome is verified remotely.
 * `run(ctx)` performs the mutation(s); `verify(ctx)` re-reads and throws when
 * the remote outcome is not what the step claimed.
 */
function step(desc, { commands, run, verify, verifyDesc }) {
  return { desc, commands, run, verify, verifyDesc };
}

function printPlan(name, sandbox, steps, execute) {
  process.stdout.write(
    `\n${execute ? "EXECUTING" : "DRY-RUN (nothing will be touched; add --execute to perform)"}: ${name} → ${sandbox.nameWithOwner}\n\n`,
  );
  steps.forEach((s, i) => {
    process.stdout.write(`${i + 1}. ${s.desc}\n`);
    for (const c of s.commands) process.stdout.write(`     $ ${c}\n`);
    if (s.verifyDesc) process.stdout.write(`     verify: ${s.verifyDesc}\n`);
  });
  process.stdout.write("\n");
}

async function performPlan(name, sandbox, steps) {
  const done = [];
  for (const [i, s] of steps.entries()) {
    process.stdout.write(`[${i + 1}/${steps.length}] ${s.desc}\n`);
    try {
      const ctx = (await s.run?.()) ?? {};
      if (s.verify) {
        await s.verify(ctx);
        process.stdout.write(`  verified: ${s.verifyDesc ?? "ok"}\n`);
      }
      done.push(s.desc);
    } catch (err) {
      writeFailureArtifact(name, sandbox, s.desc, done, err);
      throw err;
    }
  }
  process.stdout.write(`\n${name}: every step verified against the remote.\n`);
}

/** Sanitized survivors of a failed execute run — and the lock on the door. */
function writeFailureArtifact(command, sandbox, failedStep, completedSteps, err) {
  const artifact = {
    $comment:
      "A sandbox --execute run failed. Inspect the sandbox, clean up (usually " +
      "`node scripts/github/sandbox.mjs cleanup --execute`), then DELETE this " +
      "file — its existence blocks every further --execute run.",
    command,
    repo: sandbox.nameWithOwner,
    failedStep,
    completedSteps,
    error: scrubSecrets(String(err?.message ?? err)).slice(0, 2000),
    at: new Date().toISOString(),
  };
  fs.writeFileSync(FAILURE_ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stderr.write(
    `\nFAILED at "${failedStep}". State written to ${FAILURE_ARTIFACT}; ` +
      "further --execute runs are blocked until a human cleans up and deletes it.\n",
  );
}

function refuseIfFailureArtifact() {
  if (fs.existsSync(FAILURE_ARTIFACT)) {
    throw new Error(
      `${FAILURE_ARTIFACT} exists — a previous --execute run failed and its ` +
        "leftovers have not been cleared by a human. Inspect the sandbox, run " +
        "cleanup, then delete that file to unblock execution.",
    );
  }
}

// ---------------------------------------------------------------------------
// live probes
// ---------------------------------------------------------------------------

function repoExists(sandbox) {
  return tryRead(["repo", "view", sandbox.nameWithOwner, "--json", "name"]) !== null;
}

function hasMarkerTopic(sandbox) {
  const topics = tryRead([
    "repo",
    "view",
    sandbox.nameWithOwner,
    "--json",
    "repositoryTopics",
    "--jq",
    ".repositoryTopics[].name",
  ]);
  return (topics ?? "").split(/\r?\n/).some((t) => t.trim() === SANDBOX_TOPIC);
}

/** The marker double-check every executing mutation command starts with. */
function assertMarkedSandbox(sandbox) {
  if (!repoExists(sandbox)) {
    throw new Error(
      `${sandbox.nameWithOwner} does not exist. Run \`setup --execute\` first (see the runbook).`,
    );
  }
  if (!hasMarkerTopic(sandbox)) {
    throw new Error(
      `${sandbox.nameWithOwner} exists but does NOT carry the '${SANDBOX_TOPIC}' topic. ` +
        "Refusing to mutate: either this is not the sandbox this harness built, or " +
        "setup never finished. Inspect it by hand before anything else touches it.",
    );
  }
}

function ourRulesetIds(sandbox) {
  const out = tryRead([
    "api",
    `repos/${sandbox.nameWithOwner}/rulesets`,
    "--jq",
    `.[] | select(.name == "${RULESET_NAME}") | .id`,
  ]);
  return (out ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function cmdStatus(sandbox) {
  process.stdout.write(`sandbox target: ${sandbox.nameWithOwner}\n`);
  process.stdout.write(
    `failure artifact: ${fs.existsSync(FAILURE_ARTIFACT) ? `PRESENT (${FAILURE_ARTIFACT}) — execution blocked` : "none"}\n`,
  );
  if (!repoExists(sandbox)) {
    process.stdout.write("repo: does not exist (run `setup`)\n");
    return;
  }
  process.stdout.write(`repo: exists; marker topic '${SANDBOX_TOPIC}': ${hasMarkerTopic(sandbox) ? "present" : "MISSING"}\n`);
  const prs = tryRead(["pr", "list", "-R", sandbox.nameWithOwner, "--state", "open", "--json", "number,title", "--jq", "length"]);
  const issues = tryRead(["issue", "list", "-R", sandbox.nameWithOwner, "--state", "open", "--json", "number", "--jq", "length"]);
  const branches = tryRead(["api", `repos/${sandbox.nameWithOwner}/branches`, "--jq", "[.[].name] | join(\", \")"]);
  const rulesets = ourRulesetIds(sandbox);
  const rules = tryRead(["api", `repos/${sandbox.nameWithOwner}/rules/branches/main`, "--jq", "length"]);
  process.stdout.write(`open PRs: ${prs ?? "?"}; open issues: ${issues ?? "?"}\n`);
  process.stdout.write(`branches: ${branches ?? "?"}\n`);
  process.stdout.write(
    `our ruleset (${RULESET_NAME}): ${rulesets.length > 0 ? `active (id ${rulesets.join(", ")})` : "not applied"}; rules on main: ${rules ?? "?"}\n`,
  );
}

function setupSteps(sandbox) {
  const repo = sandbox.nameWithOwner;
  return [
    step(`create ${repo} (public — free-account rulesets are only enforced on public repos) with a README`, {
      commands: [`gh repo create ${repo} --public --add-readme -d "Disposable sandbox for uxnan's GitHub live validation. Safe to delete."`],
      run: () => {
        if (repoExists(sandbox)) {
          if (!hasMarkerTopic(sandbox)) {
            throw new Error(
              `${repo} already exists WITHOUT the '${SANDBOX_TOPIC}' marker — refusing to adopt ` +
                "a repository this harness did not build. Inspect it by hand.",
            );
          }
          process.stdout.write("  already exists with the marker; skipping creation\n");
          return;
        }
        mutate(sandbox, [
          "repo",
          "create",
          repo,
          "--public",
          "--add-readme",
          "-d",
          "Disposable sandbox for uxnan's GitHub live validation. Safe to delete.",
        ]);
      },
      verify: () => {
        if (!repoExists(sandbox)) throw new Error("repo not readable after creation");
      },
      verifyDesc: "gh repo view answers for the new repo",
    }),
    step(`stamp the '${SANDBOX_TOPIC}' marker topic (the second lock every mutating run re-checks)`, {
      commands: [`gh api repos/${repo}/topics -X PUT -f "names[]=${SANDBOX_TOPIC}"`],
      run: () => {
        mutate(sandbox, ["api", `repos/${repo}/topics`, "-X", "PUT", "-f", `names[]=${SANDBOX_TOPIC}`]);
      },
      verify: () => {
        if (!hasMarkerTopic(sandbox)) throw new Error("marker topic not visible after PUT");
      },
      verifyDesc: `the topic list re-read contains '${SANDBOX_TOPIC}'`,
    }),
    step("commit the innocuous dispatch-only sleep workflow (gives run-cancel a guaranteed target)", {
      commands: [`gh api repos/${repo}/contents/.github/workflows/sleep.yml -X PUT -f message=... -f content=<base64>`],
      run: () => {
        const existing = tryRead([
          "api",
          `repos/${repo}/contents/.github/workflows/sleep.yml`,
          "--jq",
          ".sha",
        ]);
        const args = [
          "api",
          `repos/${repo}/contents/.github/workflows/sleep.yml`,
          "-X",
          "PUT",
          "-f",
          "message=ci: add the sleep fixture workflow",
          "-f",
          `content=${Buffer.from(SLEEP_WORKFLOW, "utf8").toString("base64")}`,
        ];
        if (existing) args.push("-f", `sha=${existing}`);
        mutate(sandbox, args);
      },
      verify: () => {
        const wf = tryRead(["api", `repos/${repo}/contents/.github/workflows/sleep.yml`, "--jq", ".name"]);
        if (wf !== "sleep.yml") throw new Error("sleep.yml not readable after PUT");
      },
      verifyDesc: "the workflow file re-reads from the contents API",
    }),
    step("enable auto-merge on the repo (so the --auto path can be validated later)", {
      commands: [`gh api repos/${repo} -X PATCH -F allow_auto_merge=true`],
      run: () => {
        mutate(sandbox, ["api", `repos/${repo}`, "-X", "PATCH", "-F", "allow_auto_merge=true"]);
      },
      verify: () => {
        const v = tryRead(["api", `repos/${repo}`, "--jq", ".allow_auto_merge"]);
        if (v !== "true") throw new Error(`allow_auto_merge is ${v} after PATCH`);
      },
      verifyDesc: "REST re-read reports allow_auto_merge=true",
    }),
  ];
}

function protectSteps(sandbox) {
  const repo = sandbox.nameWithOwner;
  const ruleset = {
    name: RULESET_NAME,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          allowed_merge_methods: ["merge", "squash"],
        },
      },
    ],
  };
  return [
    step(`apply the '${RULESET_NAME}' ruleset to main (mirrors production: 1 review, thread resolution, merge+squash only)`, {
      commands: [`gh api repos/${repo}/rulesets -X POST --input - <ruleset JSON>`],
      run: () => {
        if (ourRulesetIds(sandbox).length > 0) {
          process.stdout.write("  already applied; skipping\n");
          return;
        }
        mutate(sandbox, ["api", `repos/${repo}/rulesets`, "-X", "POST", "--input", "-"], {
          input: JSON.stringify(ruleset),
        });
      },
      verify: () => {
        const rules = tryRead(["api", `repos/${repo}/rules/branches/main`, "--jq", "[.[].type] | join(\",\")"]);
        if (!(rules ?? "").includes("pull_request")) {
          throw new Error(`main's effective rules are [${rules}] — the pull_request rule is not active`);
        }
      },
      verifyDesc: "GET /rules/branches/main shows the pull_request rule active",
    }),
  ];
}

function unprotectSteps(sandbox) {
  const repo = sandbox.nameWithOwner;
  return [
    step(`delete every '${RULESET_NAME}' ruleset (ours and only ours)`, {
      commands: [`gh api repos/${repo}/rulesets/<id> -X DELETE   # for each of ours`],
      run: () => {
        const ids = ourRulesetIds(sandbox);
        if (ids.length === 0) {
          process.stdout.write("  none applied; nothing to delete\n");
          return;
        }
        for (const id of ids) {
          mutate(sandbox, ["api", `repos/${repo}/rulesets/${id}`, "-X", "DELETE"]);
        }
      },
      verify: () => {
        const ids = ourRulesetIds(sandbox);
        if (ids.length > 0) throw new Error(`ruleset ids still present: ${ids.join(", ")}`);
      },
      verifyDesc: "the rulesets list no longer contains ours",
    }),
  ];
}

function cleanupSteps(sandbox, { deleteRepo }) {
  const repo = sandbox.nameWithOwner;
  const steps = [
    step("close every open PR (idempotent: an empty list is success)", {
      commands: [`gh pr close <n> -R ${repo}   # for each open PR`],
      run: () => {
        const out = tryRead(["pr", "list", "-R", repo, "--state", "open", "--json", "number", "--jq", ".[].number"]) ?? "";
        const numbers = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        for (const n of numbers) mutate(sandbox, ["pr", "close", n, "-R", repo]);
        return { numbers };
      },
      verify: () => {
        const left = tryRead(["pr", "list", "-R", repo, "--state", "open", "--json", "number", "--jq", "length"]);
        if (left !== "0") throw new Error(`${left} PRs still open`);
      },
      verifyDesc: "the open-PR list re-reads as empty",
    }),
    step("close every open issue (idempotent)", {
      commands: [`gh issue close <n> -R ${repo}   # for each open issue`],
      run: () => {
        const out = tryRead(["issue", "list", "-R", repo, "--state", "open", "--json", "number", "--jq", ".[].number"]) ?? "";
        const numbers = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        for (const n of numbers) mutate(sandbox, ["issue", "close", n, "-R", repo]);
      },
      verify: () => {
        const left = tryRead(["issue", "list", "-R", repo, "--state", "open", "--json", "number", "--jq", "length"]);
        if (left !== "0") throw new Error(`${left} issues still open`);
      },
      verifyDesc: "the open-issue list re-reads as empty",
    }),
    step("cancel any in-progress workflow runs (idempotent)", {
      commands: [`gh run cancel <id> -R ${repo}   # for each queued/in-progress run`],
      run: () => {
        const out =
          tryRead(["run", "list", "-R", repo, "--json", "databaseId,status", "--jq", '.[] | select(.status == "in_progress" or .status == "queued") | .databaseId']) ?? "";
        for (const id of out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
          // A run may settle between the read and the cancel; that is fine.
          try {
            mutate(sandbox, ["run", "cancel", String(id), "-R", repo]);
          } catch {
            process.stdout.write(`  run ${id} already settled\n`);
          }
        }
      },
      verifyDesc: "best-effort — a run may finish on its own between read and cancel",
    }),
    step("delete every branch except main (the tests' feat/* leftovers)", {
      commands: [`gh api repos/${repo}/git/refs/heads/<branch> -X DELETE   # for each non-main branch`],
      run: () => {
        const out = tryRead(["api", `repos/${repo}/branches`, "--jq", ".[].name"]) ?? "";
        const branches = out.split(/\r?\n/).map((s) => s.trim()).filter((b) => b && b !== "main");
        for (const b of branches) {
          mutate(sandbox, ["api", `repos/${repo}/git/refs/heads/${b}`, "-X", "DELETE"]);
        }
        return { branches };
      },
      verify: () => {
        const out = tryRead(["api", `repos/${repo}/branches`, "--jq", "[.[].name] | join(\",\")"]);
        if ((out ?? "") !== "main") throw new Error(`branches left: ${out}`);
      },
      verifyDesc: "the branch list re-reads as exactly [main]",
    }),
  ];
  if (deleteRepo) {
    steps.push(
      step("delete the sandbox repository itself (needs the delete_repo scope: `gh auth refresh -h github.com -s delete_repo`)", {
        commands: [`gh repo delete ${repo} --yes`],
        run: () => {
          mutate(sandbox, ["repo", "delete", repo, "--yes"]);
        },
        verify: () => {
          if (repoExists(sandbox)) throw new Error("repo still readable after delete");
        },
        verifyDesc: "gh repo view no longer answers",
      }),
    );
  }
  return steps;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.find((a) => !a.startsWith("--"));
  const execute = argv.includes("--execute");
  const deleteRepo = argv.includes("--delete-repo");
  const known = ["status", "setup", "protect", "unprotect", "cleanup"];
  if (!command || !known.includes(command)) {
    process.stderr.write(`usage: node scripts/github/sandbox.mjs <${known.join("|")}> [--execute] [--delete-repo]\n`);
    process.exit(64);
  }

  // The allowlist gate: no UXNAN_GH_SANDBOX (or a wrong one) stops everything,
  // including dry-runs — a plan for the wrong repo is already a mistake.
  const sandbox = requireSandbox(process.env);

  if (command === "status") {
    cmdStatus(sandbox);
    return;
  }

  const steps =
    command === "setup"
      ? setupSteps(sandbox)
      : command === "protect"
        ? protectSteps(sandbox)
        : command === "unprotect"
          ? unprotectSteps(sandbox)
          : cleanupSteps(sandbox, { deleteRepo });

  printPlan(command, sandbox, steps, execute);
  if (!execute) return;

  refuseIfFailureArtifact();
  // The marker double-check before anything mutates. Setup is the one command
  // allowed to find no repo (it creates it) — its first step re-checks on its
  // own terms (refusing an unmarked existing repo).
  if (command !== "setup") assertMarkedSandbox(sandbox);
  await performPlan(command, sandbox, steps);
}

main().catch((err) => {
  process.stderr.write(`${scrubSecrets(String(err?.message ?? err))}\n`);
  process.exit(1);
});
