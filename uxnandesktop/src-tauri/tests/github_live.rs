//! **Supervised live suite** — the production GitHub layer against the real,
//! allowlisted sandbox repository. The written half of the validation story:
//! the offline suites prove the parsers and the runner; only this one proves
//! that a PR really opens, a merge really merges, and every refusal message we
//! model is what GitHub actually says.
//!
//! # Ground rules (non-negotiable)
//!
//! - **Every test is `#[ignore]`.** The required suite (`cargo test`) must run
//!   with no network and no account; nothing here is ever part of it.
//! - **Armed only by `UXNAN_GH_SANDBOX`,** which must equal the one allowlisted
//!   sandbox (`luisgamas/uxnan-gh-sandbox`) exactly. Unset, wrong, or naming
//!   the production repo → the run fails immediately with an explanation. The
//!   guard is pure and unit-tested below (those tests are *not* ignored).
//! - **The sandbox must self-identify** (the `uxnan-gh-sandbox` topic its setup
//!   stamps on it) — checked over the network before the first mutation, so a
//!   name collision can't be mutated either.
//! - **First runs are supervised.** These tests mutate a real repository; the
//!   operator follows `docs/github-sandbox-runbook.md`, which pairs each test
//!   with the sandbox state it needs (`scripts/github/sandbox.mjs` builds it)
//!   and with what to check when something is left half-done. No token is ever
//!   read or passed: `gh` owns authentication, same as production.
//! - **Remote outcome is verified by re-reading.** A mutation asserting only
//!   "exit 0" would validate gh's exit code, not the app's claim; every write
//!   here is followed by the corresponding read.
//!
//! Run (after the runbook's setup):
//!
//! ```text
//! UXNAN_GH_SANDBOX=luisgamas/uxnan-gh-sandbox \
//!   cargo test --test github_live -- --ignored --nocapture --test-threads=1
//! ```

use std::path::{Path, PathBuf};
use std::process::Command;

use uxnan_desktop_lib::github;

/// The one repository this suite may mutate. Must match
/// `scripts/github/lib.mjs` (`SANDBOX_REPO`) — the harness that builds it.
const SANDBOX_REPO: &str = "luisgamas/uxnan-gh-sandbox";

/// Refused by name even if someone edits `SANDBOX_REPO`: the production
/// monorepo this code lives in.
const FORBIDDEN_REPOS: [&str; 1] = ["luisgamas/uxnan"];

/// The topic the sandbox is created with; re-checked live before any mutation.
const SANDBOX_TOPIC: &str = "uxnan-gh-sandbox";

// ---------------------------------------------------------------------------
// the guard (pure, unit-tested WITHOUT --ignored)
// ---------------------------------------------------------------------------

/// Validate a `UXNAN_GH_SANDBOX` value. `Err` carries the full refusal message.
fn validate_sandbox_env(value: Option<&str>) -> Result<String, String> {
    let Some(raw) = value else {
        return Err(format!(
            "UXNAN_GH_SANDBOX is not set.\n\n\
             The github_live tests MUTATE a real GitHub repository, so they refuse to\n\
             guess which one. Build the sandbox first (scripts/github/sandbox.mjs, see\n\
             docs/github-sandbox-runbook.md), then arm this run with:\n\n  \
             UXNAN_GH_SANDBOX={SANDBOX_REPO}\n\n\
             That exact value is the only one accepted."
        ));
    };
    let value = raw.trim();
    if value.is_empty() {
        return Err("UXNAN_GH_SANDBOX is empty — refusing to guess a repository.".to_string());
    }
    if FORBIDDEN_REPOS.contains(&value) {
        return Err(format!(
            "UXNAN_GH_SANDBOX points at {value}, which is a PRODUCTION repository.\n\
             This suite will never mutate it. Use the disposable sandbox: {SANDBOX_REPO}"
        ));
    }
    if value != SANDBOX_REPO {
        return Err(format!(
            "UXNAN_GH_SANDBOX is \"{value}\", but the only allowlisted sandbox is\n\
             \"{SANDBOX_REPO}\". Refusing: mutations must never follow a value nobody meant."
        ));
    }
    Ok(value.to_string())
}

/// The armed sandbox, or a panic that explains exactly what to do.
fn sandbox() -> String {
    match validate_sandbox_env(std::env::var("UXNAN_GH_SANDBOX").ok().as_deref()) {
        Ok(repo) => repo,
        Err(msg) => panic!("\n{msg}\n"),
    }
}

#[test]
fn guard_refuses_when_unset() {
    let err = validate_sandbox_env(None).unwrap_err();
    assert!(err.contains("UXNAN_GH_SANDBOX is not set"));
    assert!(err.contains(SANDBOX_REPO), "the message must name the fix");
    assert!(err.contains("runbook"), "and point at the runbook");
}

#[test]
fn guard_refuses_the_production_repo_by_name() {
    let err = validate_sandbox_env(Some("luisgamas/uxnan")).unwrap_err();
    assert!(err.contains("PRODUCTION"), "got {err:?}");
    assert!(err.contains(SANDBOX_REPO));
}

#[test]
fn guard_refuses_anything_not_exactly_the_allowlist() {
    for wrong in [
        "luisgamas/uxnan-gh-sandbox-2",
        "someone-else/uxnan-gh-sandbox",
        "LUISGAMAS/UXNAN-GH-SANDBOX",
        "https://github.com/luisgamas/uxnan-gh-sandbox",
        "",
        "   ",
    ] {
        assert!(
            validate_sandbox_env(Some(wrong)).is_err(),
            "{wrong:?} must be refused"
        );
    }
    assert_eq!(
        validate_sandbox_env(Some(SANDBOX_REPO)).unwrap(),
        SANDBOX_REPO
    );
    // Only trimming is tolerated — an exact value with stray whitespace is
    // still unambiguous.
    assert_eq!(
        validate_sandbox_env(Some(" luisgamas/uxnan-gh-sandbox ")).unwrap(),
        SANDBOX_REPO
    );
}

// ---------------------------------------------------------------------------
// live helpers (used by #[ignore] tests only)
// ---------------------------------------------------------------------------

/// Run `gh` directly (reads + the test-scoped git pushes the runbook covers).
/// Only used by the ignored tests; panics with stderr on failure.
fn run(cmd: &str, args: &[&str], dir: Option<&Path>) -> String {
    let mut c = Command::new(cmd);
    c.args(args);
    if let Some(dir) = dir {
        c.current_dir(dir);
    }
    let out = c.output().unwrap_or_else(|e| panic!("spawn {cmd}: {e}"));
    if !out.status.success() {
        panic!(
            "{cmd} {} failed ({}):\n{}",
            args.join(" "),
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// The second lock on the door: beyond the exact name, the repository itself
/// must carry the sandbox topic its setup stamped on it. A fresh clone/create
/// collision without the marker is refused before anything is written.
fn assert_sandbox_marker(repo: &str) {
    let topics = run(
        "gh",
        &[
            "repo",
            "view",
            repo,
            "--json",
            "repositoryTopics",
            "--jq",
            ".repositoryTopics[].name",
        ],
        None,
    );
    assert!(
        topics.lines().any(|t| t.trim() == SANDBOX_TOPIC),
        "{repo} does not carry the '{SANDBOX_TOPIC}' topic. Refusing to mutate: \
         run `node scripts/github/sandbox.mjs setup` (see docs/github-sandbox-runbook.md) \
         so the sandbox self-identifies, or you are pointing at the wrong repository."
    );
}

/// Clone the sandbox into a temp dir through the production clone path and
/// verify the checkout really points at it.
async fn clone_sandbox(tmp: &tempfile::TempDir, repo: &str) -> PathBuf {
    let dest = tmp.path().join("sandbox");
    let dest_str = dest.to_string_lossy().to_string();
    github::clone(repo, &dest_str).await.expect("clone sandbox");
    let ctx = github::repo_context(&dest_str)
        .await
        .expect("the clone is a GitHub repo");
    assert_eq!(ctx.name_with_owner, repo, "the clone tracks the sandbox");
    dest
}

/// Extract the trailing number from a PR/issue URL gh printed.
fn number_from_url(url: &str) -> String {
    url.rsplit('/')
        .next()
        .unwrap_or_else(|| panic!("no number in {url}"))
        .to_string()
}

/// A unique, greppable suffix so parallel/retried runs never collide and
/// leftovers are attributable (`uxnan-live-<epoch-secs>`).
fn run_tag() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs();
    format!("uxnan-live-{secs}")
}

// ---------------------------------------------------------------------------
// live tests — every one #[ignore]; see the module doc for how to run them
// ---------------------------------------------------------------------------

/// Reads only: the signed-in account and the sandbox context resolve through
/// the production functions. The gentlest first step of a supervised run.
#[tokio::test]
#[ignore = "mutates nothing, but requires gh + the allowlisted sandbox (UXNAN_GH_SANDBOX)"]
async fn github_live_status_and_context_resolve_the_sandbox() {
    let repo = sandbox();
    assert_sandbox_marker(&repo);
    let status = github::status().await;
    assert!(status.gh_installed && status.authenticated, "{status:?}");
    assert!(
        status.scopes.iter().any(|s| s == "repo"),
        "the repo scope is what every write below needs: {:?}",
        status.scopes
    );
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir = clone_sandbox(&tmp, &repo).await;
    let dir = dir.to_string_lossy();
    let branches = github::pr_branches(&dir).await.expect("branches");
    assert!(
        !branches.remote.is_empty(),
        "the sandbox has pushed branches"
    );
    assert!(!branches.default_base.is_empty());
    let limit = github::rate_limit().await.expect("rate limit");
    assert!(limit.limit > 0);
}

/// Issue lifecycle: create (labeled) → edit → comment → close → reopen →
/// close. Each step re-read through the production views before moving on.
#[tokio::test]
#[ignore = "MUTATES the sandbox repository — run supervised per docs/github-sandbox-runbook.md"]
async fn github_live_issue_lifecycle_is_verified_remotely() {
    let repo = sandbox();
    assert_sandbox_marker(&repo);
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir = clone_sandbox(&tmp, &repo).await;
    let dir = dir.to_string_lossy();
    let tag = run_tag();

    let labels = github::labels(&dir).await.expect("labels");
    assert!(
        labels.iter().any(|l| l.name == "bug"),
        "setup seeds the default labels"
    );

    let title = format!("Live validation issue {tag}");
    let url = github::issue_create(
        &dir,
        &title,
        "Created by github_live; safe to close.",
        &["bug".to_string()],
        &[],
    )
    .await
    .expect("issue create");
    let number = number_from_url(&url);

    let seen = github::issue_view(&dir, &number).await.expect("issue view");
    assert_eq!(seen.title, title, "remote outcome, not exit code");
    assert_eq!(seen.state, "OPEN");
    assert!(seen.labels.contains(&"bug".to_string()));

    let renamed = format!("{title} (edited)");
    github::issue_edit(&dir, &number, Some(&renamed), None)
        .await
        .expect("issue edit");
    github::issue_comment(&dir, &number, "A comment from the live suite.")
        .await
        .expect("issue comment");
    let seen = github::issue_view(&dir, &number).await.expect("re-view");
    assert_eq!(seen.title, renamed);
    assert_eq!(seen.comments.len(), 1);

    github::issue_close(&dir, &number).await.expect("close");
    let seen = github::issue_view(&dir, &number)
        .await
        .expect("view closed");
    assert_eq!(seen.state, "CLOSED");
    github::issue_reopen(&dir, &number).await.expect("reopen");
    let seen = github::issue_view(&dir, &number)
        .await
        .expect("view reopened");
    assert_eq!(seen.state, "OPEN");
    // Leave it closed: the cleanup posture is "nothing left open".
    github::issue_close(&dir, &number)
        .await
        .expect("final close");
}

/// PR lifecycle on an unprotected base: branch → push → create → comment →
/// review-comment → merge (squash, `--match-head-commit`) → verify MERGED.
///
/// Single-account limits validated here as *refusals*: approving or
/// requesting changes on your own PR is refused by GitHub — asserted, since
/// that is exactly what a solo operator will hit in production.
#[tokio::test]
#[ignore = "MUTATES the sandbox repository — run supervised per docs/github-sandbox-runbook.md"]
async fn github_live_pr_lifecycle_create_review_merge() {
    let repo = sandbox();
    assert_sandbox_marker(&repo);
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir_path = clone_sandbox(&tmp, &repo).await;
    let dir = dir_path.to_string_lossy();
    let tag = run_tag();
    let branch = format!("feat/{tag}");

    // A real commit to merge (supervised: this push is scoped to the sandbox).
    run("git", &["checkout", "-b", &branch], Some(&dir_path));
    std::fs::write(dir_path.join(format!("{tag}.txt")), "live validation\n").expect("write file");
    run("git", &["add", "."], Some(&dir_path));
    run(
        "git",
        &["commit", "-m", &format!("test: {tag}")],
        Some(&dir_path),
    );
    run("git", &["push", "-u", "origin", &branch], Some(&dir_path));

    let url = github::pr_create(
        &dir,
        serde_json::from_value(serde_json::json!({
            "title": format!("Live validation PR {tag}"),
            "body": "Opened by github_live; merged into main by the same run.",
            "base": "main",
            "head": branch,
        }))
        .expect("create options"),
    )
    .await
    .expect("pr create");
    let number = number_from_url(&url);

    let detail = github::pr_view(&dir, &number).await.expect("pr view");
    assert_eq!(detail.state, "OPEN");
    assert_eq!(detail.head_ref_name.as_deref(), Some(branch.as_str()));

    github::pr_comment(&dir, &number, "Conversation comment from the live suite.")
        .await
        .expect("pr comment");
    github::pr_review(
        &dir,
        &number,
        "comment",
        Some("Review comment from the live suite."),
    )
    .await
    .expect("review comment");
    // Single-account truth: self-approval must be refused by GitHub.
    let self_approve = github::pr_review(&dir, &number, "approve", None).await;
    assert!(
        self_approve.is_err(),
        "GitHub must refuse approving your own PR; got {self_approve:?}"
    );

    let info = github::merge_info(&dir, &number, "main")
        .await
        .expect("merge info");
    assert!(
        info.policy.allowed_methods.contains(&"squash".to_string()),
        "unprotected phase: squash offered"
    );
    let head = info
        .state
        .as_ref()
        .and_then(|s| s.head_oid.clone())
        .expect("head oid for --match-head-commit");

    github::pr_merge(
        &dir,
        &number,
        serde_json::from_value(serde_json::json!({
            "method": "squash",
            "deleteBranch": true,
            "matchHeadCommit": head,
        }))
        .expect("merge options"),
    )
    .await
    .expect("merge");

    let merged = github::pr_view(&dir, &number)
        .await
        .expect("view after merge");
    assert_eq!(merged.state, "MERGED", "remote outcome, not exit code");
    let timeline = github::pr_timeline(&dir, &number).await.expect("timeline");
    assert!(timeline.iter().any(|e| e.event == "merged"));
}

/// `--match-head-commit` against a stale head: push after reading the oid,
/// then merge with the old one — GitHub must refuse, and the PR must still be
/// open afterwards. This is the mid-review-push race the flag exists for.
#[tokio::test]
#[ignore = "MUTATES the sandbox repository — run supervised per docs/github-sandbox-runbook.md"]
async fn github_live_stale_head_merge_is_refused() {
    let repo = sandbox();
    assert_sandbox_marker(&repo);
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir_path = clone_sandbox(&tmp, &repo).await;
    let dir = dir_path.to_string_lossy();
    let tag = run_tag();
    let branch = format!("feat/{tag}-stale");

    run("git", &["checkout", "-b", &branch], Some(&dir_path));
    std::fs::write(dir_path.join(format!("{tag}-stale.txt")), "v1\n").expect("write");
    run("git", &["add", "."], Some(&dir_path));
    run(
        "git",
        &["commit", "-m", &format!("test: {tag} v1")],
        Some(&dir_path),
    );
    run("git", &["push", "-u", "origin", &branch], Some(&dir_path));

    let url = github::pr_create(
        &dir,
        serde_json::from_value(serde_json::json!({
            "title": format!("Stale-head validation {tag}"),
            "body": "The run pushes after reading the head oid, then merges with the old one.",
            "base": "main",
            "head": branch,
        }))
        .expect("create options"),
    )
    .await
    .expect("pr create");
    let number = number_from_url(&url);

    let info = github::merge_info(&dir, &number, "main")
        .await
        .expect("merge info");
    let stale_head = info
        .state
        .as_ref()
        .and_then(|s| s.head_oid.clone())
        .expect("head oid");

    // The race: a new commit lands after the UI read its head.
    std::fs::write(dir_path.join(format!("{tag}-stale.txt")), "v2\n").expect("write v2");
    run(
        "git",
        &["commit", "-am", &format!("test: {tag} v2")],
        Some(&dir_path),
    );
    run("git", &["push"], Some(&dir_path));

    let refused = github::pr_merge(
        &dir,
        &number,
        serde_json::from_value(serde_json::json!({
            "method": "squash",
            "matchHeadCommit": stale_head,
        }))
        .expect("merge options"),
    )
    .await;
    let err = match refused {
        Err(e) => format!("{e}"),
        Ok(()) => panic!("a stale --match-head-commit merge must be refused"),
    };
    println!("stale-head refusal (verbatim, for mutation-outcomes.json): {err}");

    let still_open = github::pr_view(&dir, &number).await.expect("view");
    assert_eq!(
        still_open.state, "OPEN",
        "the refused merge changed nothing"
    );
    // Cleanup: close the PR; the branch is deleted by the harness cleanup.
    github::pr_close(&dir, &number).await.expect("close");
}

/// Draft flow: a draft PR refuses to merge, `pr_ready` takes it out of draft,
/// and the merge then proceeds. Requires nothing protected.
#[tokio::test]
#[ignore = "MUTATES the sandbox repository — run supervised per docs/github-sandbox-runbook.md"]
async fn github_live_draft_refuses_merge_until_ready() {
    let repo = sandbox();
    assert_sandbox_marker(&repo);
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir_path = clone_sandbox(&tmp, &repo).await;
    let dir = dir_path.to_string_lossy();
    let tag = run_tag();
    let branch = format!("feat/{tag}-draft");

    run("git", &["checkout", "-b", &branch], Some(&dir_path));
    std::fs::write(dir_path.join(format!("{tag}-draft.txt")), "draft\n").expect("write");
    run("git", &["add", "."], Some(&dir_path));
    run(
        "git",
        &["commit", "-m", &format!("test: {tag} draft")],
        Some(&dir_path),
    );
    run("git", &["push", "-u", "origin", &branch], Some(&dir_path));

    let url = github::pr_create(
        &dir,
        serde_json::from_value(serde_json::json!({
            "title": format!("Draft validation {tag}"),
            "body": "Draft → ready → merge, verified remotely at each step.",
            "base": "main",
            "head": branch,
            "draft": true,
        }))
        .expect("create options"),
    )
    .await
    .expect("pr create");
    let number = number_from_url(&url);

    let detail = github::pr_view(&dir, &number).await.expect("view");
    assert!(detail.is_draft, "created as draft");

    let refused = github::pr_merge(
        &dir,
        &number,
        serde_json::from_value(serde_json::json!({"method": "squash"})).expect("opts"),
    )
    .await;
    let err = match refused {
        Err(e) => format!("{e}"),
        Ok(()) => panic!("merging a draft must be refused"),
    };
    println!("draft refusal (verbatim, for mutation-outcomes.json): {err}");

    github::pr_ready(&dir, &number, false).await.expect("ready");
    let detail = github::pr_view(&dir, &number)
        .await
        .expect("view after ready");
    assert!(!detail.is_draft, "remote outcome: out of draft");

    let head = github::merge_info(&dir, &number, "main")
        .await
        .expect("merge info")
        .state
        .and_then(|s| s.head_oid)
        .expect("head oid");
    github::pr_merge(
        &dir,
        &number,
        serde_json::from_value(serde_json::json!({
            "method": "squash",
            "deleteBranch": true,
            "matchHeadCommit": head,
        }))
        .expect("opts"),
    )
    .await
    .expect("merge after ready");
    let merged = github::pr_view(&dir, &number).await.expect("final view");
    assert_eq!(merged.state, "MERGED");
}

/// Ruleset phase (runbook: `sandbox.mjs protect --execute` first): the policy
/// reports main protected with restricted methods, a plain merge is refused
/// with GitHub's own reason, and the admin bypass — the escape hatch the UI
/// offers behind a danger confirm — merges it. Run LAST: it flips the sandbox
/// into its protected shape (`unprotect` restores it).
#[tokio::test]
#[ignore = "MUTATES the sandbox repository and needs its ruleset applied — see the runbook"]
async fn github_live_ruleset_blocks_then_admin_bypass_merges() {
    let repo = sandbox();
    assert_sandbox_marker(&repo);
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir_path = clone_sandbox(&tmp, &repo).await;
    let dir = dir_path.to_string_lossy();
    let tag = run_tag();
    let branch = format!("feat/{tag}-ruleset");

    // The policy must see the protection the harness applied.
    let probe = github::merge_info(&dir, "1", "main")
        .await
        .expect("policy probe");
    assert!(
        probe.policy.protected,
        "run `node scripts/github/sandbox.mjs protect --execute` first (runbook step)"
    );
    assert!(
        probe.policy.required_approvals >= 1,
        "the sandbox ruleset requires a review"
    );
    assert!(
        !probe.policy.allowed_methods.contains(&"rebase".to_string()),
        "the sandbox ruleset forbids rebase, mirroring production"
    );

    run("git", &["checkout", "-b", &branch], Some(&dir_path));
    std::fs::write(dir_path.join(format!("{tag}-ruleset.txt")), "blocked\n").expect("write");
    run("git", &["add", "."], Some(&dir_path));
    run(
        "git",
        &["commit", "-m", &format!("test: {tag} ruleset")],
        Some(&dir_path),
    );
    run("git", &["push", "-u", "origin", &branch], Some(&dir_path));

    let url = github::pr_create(
        &dir,
        serde_json::from_value(serde_json::json!({
            "title": format!("Ruleset validation {tag}"),
            "body": "Blocked by the ruleset, then merged via the admin bypass.",
            "base": "main",
            "head": branch,
        }))
        .expect("create options"),
    )
    .await
    .expect("pr create");
    let number = number_from_url(&url);

    let head = github::merge_info(&dir, &number, "main")
        .await
        .expect("merge info")
        .state
        .and_then(|s| s.head_oid)
        .expect("head oid");

    let blocked = github::pr_merge(
        &dir,
        &number,
        serde_json::from_value(
            serde_json::json!({"method": "squash", "matchHeadCommit": head.clone()}),
        )
        .expect("opts"),
    )
    .await;
    let err = match blocked {
        Err(e) => format!("{e}"),
        Ok(()) => panic!("a review-requiring ruleset must block the plain merge"),
    };
    println!("ruleset refusal (verbatim, for mutation-outcomes.json): {err}");
    let still_open = github::pr_view(&dir, &number).await.expect("view");
    assert_eq!(still_open.state, "OPEN");

    github::pr_merge(
        &dir,
        &number,
        serde_json::from_value(serde_json::json!({
            "method": "squash",
            "admin": true,
            "deleteBranch": true,
            "matchHeadCommit": head,
        }))
        .expect("opts"),
    )
    .await
    .expect("admin bypass merge");
    let merged = github::pr_view(&dir, &number).await.expect("final view");
    assert_eq!(merged.state, "MERGED", "the bypass really merged it");
}

/// Actions: dispatch the harness's innocuous sleep workflow, watch it appear,
/// cancel it, and read its log once it settles. The only workflow the sandbox
/// carries sleeps for minutes precisely so cancel always has a target.
#[tokio::test]
#[ignore = "MUTATES the sandbox repository (dispatches + cancels a run) — see the runbook"]
async fn github_live_actions_dispatch_cancel_and_log() {
    let repo = sandbox();
    assert_sandbox_marker(&repo);
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir_path = clone_sandbox(&tmp, &repo).await;
    let dir = dir_path.to_string_lossy();

    // Dispatch (supervised; the workflow only sleeps and can always be
    // cancelled). `gh workflow run` has no production wrapper — dispatching is
    // not an app feature — so the test drives it directly.
    run(
        "gh",
        &["workflow", "run", "sleep.yml", "--ref", "main"],
        Some(&dir_path),
    );

    // Wait for the run to appear, then to reach a cancellable state.
    let mut run_id = None;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let runs = github::run_list(&dir, None, 10).await.expect("run list");
        if let Some(r) = runs
            .iter()
            .find(|r| r.status == "in_progress" || r.status == "queued")
        {
            run_id = Some(r.database_id.to_string());
            break;
        }
    }
    let run_id = run_id.expect("the dispatched run never appeared (check Actions)");

    github::run_cancel(&dir, &run_id).await.expect("cancel");
    let mut cancelled = false;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let runs = github::run_list(&dir, None, 20).await.expect("run list");
        if runs
            .iter()
            .any(|r| r.database_id.to_string() == run_id && r.status == "completed")
        {
            cancelled = true;
            break;
        }
    }
    assert!(
        cancelled,
        "the cancelled run must settle as completed/cancelled"
    );
    let log = github::run_log(&dir, &run_id, false)
        .await
        .expect("run log");
    assert!(!log.is_empty(), "a settled run has a readable log");
}
