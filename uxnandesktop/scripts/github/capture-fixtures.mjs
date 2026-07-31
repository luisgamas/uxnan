#!/usr/bin/env node
/**
 * Capture real `gh` responses and freeze them as sanitized fixtures.
 *
 * The GitHub layer's unit tests were written against hand-made JSON — JSON that
 * says what the author *believed* GitHub sends. This script closes that gap: it
 * runs the **same invocations `src-tauri/src/github.rs` runs**, against a real
 * public repository, and freezes what actually came back under
 * `tests/fixtures/github/`. The Rust contract tests
 * (`src-tauri/src/github/fixture_tests.rs`) and the frontend ones then feed
 * those captures to the **production parsers**, so "the parser handles GitHub's
 * real shapes" is a checked fact instead of a belief.
 *
 * **Read-only by construction.** Every invocation goes through `gh()` from
 * `lib.mjs` with its read assertion ON, which refuses to spawn anything that
 * isn't a plain read (`gh api` counts only as a GET with no fields). This
 * script has no mutation path to misuse.
 *
 * Sanitization (see `sanitizeCapture`): `node_id`/`gravatar_id` keys are
 * stripped and anything email-shaped is redacted — commit authors leak real
 * addresses through the timeline API. Everything else is preserved verbatim,
 * because the whole value of a captured fixture is that the parser sees exactly
 * what GitHub sent. Every fixture records what produced it and when.
 *
 * Usage (from `uxnandesktop/`):
 *
 *   node scripts/github/capture-fixtures.mjs             # capture from luisgamas/uxnan
 *   node scripts/github/capture-fixtures.mjs --repo o/r  # another PUBLIC repo
 *   node scripts/github/capture-fixtures.mjs --pr 132    # which PR to detail
 *
 * Re-running refreshes the captures; review the diff before committing it —
 * a changed fixture is a changed claim about what GitHub sends.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gh, sanitizeCapture } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "..", "..", "tests", "fixtures", "github");

// ---------------------------------------------------------------------------
// The exact field lists production uses (mirrored from src-tauri/src/github.rs;
// the command each fixture records is the authority if they ever drift).
// ---------------------------------------------------------------------------

const PR_SUMMARY_FIELDS =
  "number,title,state,isDraft,url,mergeable,reviewDecision,statusCheckRollup,headRefName";
const PR_LIST_FIELDS =
  "number,title,state,isDraft,url,author,headRefName,baseRefName,reviewDecision,updatedAt,statusCheckRollup";
const PR_DETAIL_FIELDS =
  "number,title,body,state,isDraft,url,author,baseRefName,headRefName," +
  "additions,deletions,changedFiles,mergeable,reviewDecision,files," +
  "statusCheckRollup,labels,assignees,createdAt,updatedAt," +
  "comments,commits,reviews,reviewRequests";
const ISSUE_LIST_FIELDS = "number,title,state,url,author,labels,assignees,updatedAt,comments";
const RUN_LIST_FIELDS =
  "databaseId,name,displayTitle,status,conclusion,headBranch,workflowName,event,createdAt,url";
const MERGE_STATE_FIELDS = "mergeStateStatus,mergeable,autoMergeRequest,headRefOid";
const REPO_MERGE_FIELDS =
  "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,deleteBranchOnMerge,viewerCanAdminister,viewerDefaultMergeMethod";

/** Keys kept from the (huge) REST repository object — the ones the merge-policy
 *  probe reads, plus just enough context to recognize the repo. */
const REPO_REST_KEYS = [
  "name",
  "full_name",
  "private",
  "visibility",
  "archived",
  "default_branch",
  "allow_auto_merge",
  "allow_squash_merge",
  "allow_merge_commit",
  "allow_rebase_merge",
  "delete_branch_on_merge",
];

function parseArgs(argv) {
  // `pr` is the PR whose detail/timeline/merge-state are captured; `diffPr` is a
  // deliberately *small* PR whose full diff is frozen (a big PR's diff would be
  // hundreds of KiB of fixture for no extra parser coverage).
  const out = { repo: "luisgamas/uxnan", pr: "132", diffPr: "131", maxTimelineEvents: 80 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo") out.repo = argv[++i];
    else if (argv[i] === "--pr") out.pr = argv[++i];
    else if (argv[i] === "--diff-pr") out.diffPr = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(out.repo)) throw new Error(`not an owner/repo: ${out.repo}`);
  if (!/^\d+$/.test(out.pr) || !/^\d+$/.test(out.diffPr)) {
    throw new Error(`not a PR number: ${out.pr} / ${out.diffPr}`);
  }
  return out;
}

/** Write one fixture: provenance wrapper + sanitized payload. */
function freeze(name, { command, payload, payloadText, sanitized = [], from }) {
  const record = {
    $comment:
      "Frozen capture of real `gh` output for the parser contract tests. " +
      "Regenerate with scripts/github/capture-fixtures.mjs and review the diff.",
    capturedWith: command,
    capturedFrom: from,
    capturedAt: new Date().toISOString().slice(0, 10),
    ghVersion: gh(["--version"]).split("\n")[0],
    sanitized: [
      "node_id/gravatar_id keys and string-valued (GraphQL) id keys stripped",
      "email-shaped strings redacted",
      ...sanitized,
    ],
    ...(payloadText !== undefined
      ? { payloadText: sanitizeCapture(payloadText) }
      : { payload: sanitizeCapture(payload) }),
  };
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`frozen ${path.relative(process.cwd(), file)}\n`);
}

function main() {
  const { repo, pr, diffPr, maxTimelineEvents } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const R = ["-R", repo];

  // --- auth (account-shaped, host-level: no repo involved) -----------------
  freeze("auth-status-json.json", {
    command: "gh auth status --json hosts",
    from: "github.com (host status)",
    payload: JSON.parse(gh(["auth", "status", "--json", "hosts"])),
  });
  freeze("auth-status-text.json", {
    command: "gh auth status",
    from: "github.com (host status)",
    payloadText: gh(["auth", "status"]),
    sanitized: ["token already masked by gh itself"],
  });

  // --- PR reads ------------------------------------------------------------
  freeze("pr-list.json", {
    command: `gh pr list --json ${PR_LIST_FIELDS} --state all --limit 10`,
    from: repo,
    payload: JSON.parse(gh(["pr", "list", ...R, "--json", PR_LIST_FIELDS, "--state", "all", "--limit", "10"])),
  });
  freeze(`pr-view-${pr}.json`, {
    command: `gh pr view ${pr} --json ${PR_DETAIL_FIELDS}`,
    from: repo,
    payload: JSON.parse(gh(["pr", "view", pr, ...R, "--json", PR_DETAIL_FIELDS])),
  });
  freeze(`pr-summary-${pr}.json`, {
    command: `gh pr view ${pr} --json ${PR_SUMMARY_FIELDS}`,
    from: repo,
    payload: JSON.parse(gh(["pr", "view", pr, ...R, "--json", PR_SUMMARY_FIELDS])),
  });
  freeze(`pr-merge-state-${pr}.json`, {
    command: `gh pr view ${pr} --json ${MERGE_STATE_FIELDS}`,
    from: repo,
    payload: JSON.parse(gh(["pr", "view", pr, ...R, "--json", MERGE_STATE_FIELDS])),
  });
  const timeline = JSON.parse(
    gh(["api", `repos/${repo}/issues/${pr}/timeline`, "--paginate"]),
  );
  freeze(`pr-timeline-${pr}.json`, {
    command: `gh api repos/${repo}/issues/${pr}/timeline --paginate`,
    from: repo,
    payload: timeline.slice(0, maxTimelineEvents),
    sanitized:
      timeline.length > maxTimelineEvents
        ? [`truncated to the first ${maxTimelineEvents} of ${timeline.length} events`]
        : [],
  });
  freeze(`pr-diff-${diffPr}.json`, {
    command: `gh pr diff ${diffPr}`,
    from: repo,
    payloadText: gh(["pr", "diff", diffPr, ...R]),
  });

  // --- merge policy probes -------------------------------------------------
  freeze("repo-view-merge.json", {
    command: `gh repo view --json ${REPO_MERGE_FIELDS}`,
    from: repo,
    payload: JSON.parse(gh(["repo", "view", repo, "--json", REPO_MERGE_FIELDS])),
  });
  const repoRest = JSON.parse(gh(["api", `repos/${repo}`]));
  freeze("repo-rest.json", {
    command: `gh api repos/${repo}`,
    from: repo,
    payload: Object.fromEntries(REPO_REST_KEYS.map((k) => [k, repoRest[k]])),
    sanitized: [`pruned to the keys the merge-policy probe reads: ${REPO_REST_KEYS.join(", ")}`],
  });
  const defaultBranch =
    repoRest.default_branch ??
    JSON.parse(gh(["repo", "view", repo, "--json", "defaultBranchRef"])).defaultBranchRef?.name;
  freeze("rules-branches-main.json", {
    command: `gh api repos/${repo}/rules/branches/${defaultBranch}`,
    from: repo,
    payload: JSON.parse(gh(["api", `repos/${repo}/rules/branches/${defaultBranch}`])),
  });
  freeze("default-branch.json", {
    command: "gh repo view --json defaultBranchRef",
    from: repo,
    payload: JSON.parse(gh(["repo", "view", repo, "--json", "defaultBranchRef"])),
  });

  // --- issues / labels / runs ----------------------------------------------
  freeze("issue-list.json", {
    command: `gh issue list --json ${ISSUE_LIST_FIELDS} --state all --limit 10`,
    from: repo,
    payload: JSON.parse(
      gh(["issue", "list", ...R, "--json", ISSUE_LIST_FIELDS, "--state", "all", "--limit", "10"]),
    ),
  });
  freeze("label-list.json", {
    command: "gh label list --json name,color --limit 100",
    from: repo,
    payload: JSON.parse(gh(["label", "list", ...R, "--json", "name,color", "--limit", "100"])),
  });
  freeze("run-list.json", {
    command: `gh run list --json ${RUN_LIST_FIELDS} --limit 10`,
    from: repo,
    payload: JSON.parse(gh(["run", "list", ...R, "--json", RUN_LIST_FIELDS, "--limit", "10"])),
  });

  // --- quota ---------------------------------------------------------------
  freeze("rate-limit.json", {
    command: "gh api rate_limit",
    from: "github.com (account quota)",
    payload: JSON.parse(gh(["api", "rate_limit"])),
  });

  process.stdout.write("done — review the diff before committing.\n");
}

main();
