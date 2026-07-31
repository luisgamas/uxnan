//! Contract tests: the production parsers against **captured real `gh` output**.
//!
//! The unit tests in `github.rs` feed the parsers JSON the author wrote — JSON
//! that encodes what GitHub was *believed* to send. These tests feed them what
//! GitHub actually sent: every fixture under `tests/fixtures/github/` was
//! captured from a real public repository (`luisgamas/uxnan`) with the same
//! invocations production runs, then sanitized (emails, GraphQL node ids) and
//! frozen — see `scripts/github/capture-fixtures.mjs`, which also records each
//! fixture's exact command and capture date in its provenance wrapper.
//!
//! What this layer proves that the hand-made fixtures could not:
//! - the field *names* and *nesting* production requests are what GitHub
//!   returns (a typo'd `--json` field list dies here, not in the UI);
//! - real-world quirks stay handled — an in-progress run's `"conclusion": ""`,
//!   a bot comment's hidden-HTML-marker body, a merged PR's
//!   `mergeStateStatus: "UNKNOWN"`, the ruleset that really guards `main`;
//! - re-capturing (same script) turns any GitHub-side format drift into a
//!   reviewable fixture diff instead of a production surprise.
//!
//! No network, no `gh`: the captures are files. The **live** complement — the
//! same production functions against the real sandbox repository — is
//! `tests/github_live.rs` (ignored; supervised).

use super::*;

/// Load a frozen fixture's payload. Fixtures are wrapped in a provenance object
/// (`capturedWith`/`capturedAt`/`sanitized`); the parser under test only ever
/// sees `payload` — exactly the bytes gh printed, post-sanitization.
fn fixture(name: &str) -> serde_json::Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("fixtures")
        .join("github")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read fixture {}: {e}", path.display()));
    let wrapper: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("fixture {name} is not JSON: {e}"));
    wrapper
        .get("payload")
        .cloned()
        .unwrap_or_else(|| panic!("fixture {name} has no payload"))
}

/// Like [`fixture`], for captures whose payload is plain text (`payloadText`).
fn fixture_text(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("fixtures")
        .join("github")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read fixture {}: {e}", path.display()));
    let wrapper: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("fixture {name} is not JSON: {e}"));
    wrapper
        .get("payloadText")
        .and_then(|t| t.as_str())
        .unwrap_or_else(|| panic!("fixture {name} has no payloadText"))
        .to_string()
}

#[test]
fn auth_status_json_capture_parses_to_signed_in() {
    let raw = fixture("auth-status-json.json").to_string();
    match parse_auth_status_json(&raw) {
        JsonAuthProbe::SignedIn(auth) => {
            assert_eq!(auth.host, "github.com");
            assert_eq!(auth.login, "luisgamas");
            // The JSON carries scopes as one comma-joined string; the parser
            // must split it into the same set the prose parser produces.
            assert!(auth.scopes.contains(&"repo".to_string()));
            assert!(auth.scopes.contains(&"read:org".to_string()));
            assert_eq!(auth.scopes.len(), 5);
        }
        other => panic!("expected SignedIn from the real capture, got {other:?}"),
    }
}

#[test]
fn auth_status_text_capture_parses_the_same_account() {
    let text = fixture_text("auth-status-text.json");
    let parsed = parse_auth_status(&text).expect("the real banner must parse");
    assert_eq!(parsed.host, "github.com");
    assert_eq!(parsed.login, "luisgamas");
    assert_eq!(parsed.scopes.len(), 5, "scopes: {:?}", parsed.scopes);
}

#[test]
fn pr_list_capture_maps_every_row() {
    let rows = fixture("pr-list.json");
    let rows = rows.as_array().expect("pr list is an array");
    assert_eq!(rows.len(), 10);
    let items: Vec<PrListItem> = rows.iter().map(pr_list_item_from_json).collect();
    for item in &items {
        assert!(item.number > 0);
        assert!(!item.title.is_empty());
        assert!(item.url.starts_with("https://"));
        assert!(item.author.is_some(), "gh always reports the author");
    }
    // The newest row, pinned: a merged PR whose four checks all passed.
    let first = &items[0];
    assert_eq!(first.number, 132);
    assert_eq!(first.state, "MERGED");
    assert_eq!(first.checks_summary.state, "success");
    assert_eq!(first.checks_summary.total, 4);
    assert_eq!(first.checks.len(), 4);
    assert_eq!(first.base_ref_name.as_deref(), Some("main"));
}

#[test]
fn pr_detail_capture_maps_the_whole_review_view() {
    let detail = pr_detail_from_json(&fixture("pr-view-132.json"));
    assert_eq!(detail.number, 132);
    assert_eq!(detail.state, "MERGED");
    assert!(!detail.is_draft);
    assert_eq!(detail.author.as_deref(), Some("luisgamas"));
    assert_eq!(detail.base_ref_name.as_deref(), Some("main"));
    assert_eq!(detail.changed_files, 41);
    assert_eq!(detail.files.len(), 41, "one PrFile per changed file");
    assert_eq!(detail.additions, 14467);
    assert_eq!(detail.deletions, 2596);
    // `reviewDecision` on this repo really is REVIEW_REQUIRED (a ruleset asks
    // for a review the solo maintainer cannot give — merges go through admin
    // bypass), which is exactly the shape the merge panel has to explain.
    assert_eq!(detail.review_decision.as_deref(), Some("REVIEW_REQUIRED"));
    // A real bot conversation comment (github-actions), whose body is a hidden
    // HTML marker + Markdown — the frontend renderer's job, asserted in
    // `src/lib/markdown.test.ts` against this same capture.
    assert_eq!(detail.comments.len(), 1);
    assert_eq!(detail.comments[0].author.as_deref(), Some("github-actions"));
    assert!(detail.comments[0]
        .body
        .contains("<!-- ci-failure-desktop -->"));
    // Commits carry the GitHub login (not just the git name) and a date.
    assert_eq!(detail.commits.len(), 10);
    assert_eq!(detail.commits[0].author.as_deref(), Some("luisgamas"));
    assert!(detail.commits[0].committed_at.is_some());
    // 4 checks: 3 passed and 1 SKIPPED (a conditional job that didn't fire) —
    // the skip must read as non-blocking, so the roll-up is still "success".
    assert_eq!(detail.checks_summary.state, "success");
    assert_eq!(detail.checks.len(), 4);
    assert_eq!(
        detail.checks.iter().filter(|c| c.bucket == "pass").count(),
        3
    );
    assert_eq!(
        detail.checks.iter().filter(|c| c.bucket == "skip").count(),
        1
    );
    assert!(detail.checks.iter().all(|c| c.workflow.is_some()));
    // No reviews and no requested reviewers on this repo — the empty shapes are
    // real too, and must map to empty lists rather than errors.
    assert!(detail.reviews.is_empty());
    assert!(detail.reviewers.is_empty());
}

#[test]
fn pr_summary_capture_feeds_the_worktree_badge() {
    let summary = pr_summary_from_json(&fixture("pr-summary-132.json"));
    assert_eq!(summary.number, 132);
    assert_eq!(summary.state, "MERGED");
    assert_eq!(summary.checks.state, "success");
    assert_eq!(summary.checks.total, 4);
    // A merged PR's mergeability really comes back "UNKNOWN" — the badge must
    // treat that as absence-of-signal, not as a warning.
    assert_eq!(summary.mergeable.as_deref(), Some("UNKNOWN"));
}

#[test]
fn merge_state_capture_of_a_merged_pr() {
    let state = merge_state_from_json(&fixture("pr-merge-state-132.json"));
    assert_eq!(state.status, "UNKNOWN");
    assert_eq!(state.mergeable.as_deref(), Some("UNKNOWN"));
    assert!(!state.auto_merge_enabled, "autoMergeRequest is null");
    let head = state.head_oid.expect("head oid present");
    assert_eq!(head.len(), 40, "full sha, as --match-head-commit needs");
}

#[test]
fn timeline_capture_maps_every_kept_event() {
    let events = timeline_events_from_json(&fixture("pr-timeline-132.json"));
    // The capture holds 14 events (10 commits, 1 comment, merged, closed,
    // head_ref_deleted) — all of them renderable kinds, so none is dropped.
    assert_eq!(events.len(), 14);
    let commits: Vec<_> = events.iter().filter(|e| e.event == "committed").collect();
    assert_eq!(commits.len(), 10);
    for c in &commits {
        assert_eq!(c.commit_sha.as_deref().map(str::len), Some(7));
        assert!(c.commit_message.is_some());
        assert!(c.actor.is_some(), "git author name survives sanitization");
        assert!(
            c.created_at.is_some(),
            "committed events date from author.date"
        );
    }
    let merged = events.iter().find(|e| e.event == "merged").expect("merged");
    assert_eq!(merged.actor.as_deref(), Some("luisgamas"));
    assert_eq!(merged.commit_sha.as_deref().map(str::len), Some(7));
    let commented = events
        .iter()
        .find(|e| e.event == "commented")
        .expect("commented");
    assert!(commented.body.is_some());
    assert!(events.iter().any(|e| e.event == "closed"));
    assert!(events.iter().any(|e| e.event == "head_ref_deleted"));
}

#[test]
fn real_main_ruleset_restricts_methods_and_requires_review() {
    // The ruleset that actually guards `main` on luisgamas/uxnan: deletion,
    // non_fast_forward, creation, update, and a pull_request rule allowing only
    // merge+squash with 1 required approval and thread resolution.
    let mut policy = MergePolicy::default();
    apply_branch_rules(&mut policy, &fixture("rules-branches-main.json"));
    assert!(policy.protected);
    assert_eq!(policy.allowed_methods, vec!["squash", "merge"]);
    assert_eq!(policy.required_approvals, 1);
    assert!(policy.requires_thread_resolution);
    assert!(policy.dismisses_stale_reviews);
    assert!(
        policy.required_checks.is_empty(),
        "no required checks on main"
    );
}

#[test]
fn repo_view_capture_sets_methods_and_viewer_rights() {
    let mut policy = MergePolicy::default();
    apply_repo_merge_settings(&mut policy, &fixture("repo-view-merge.json"));
    // The repo allows all three; the branch ruleset (previous test) is what
    // narrows them — asserting both halves keeps the intersection honest.
    assert_eq!(policy.allowed_methods, vec!["squash", "merge", "rebase"]);
    assert!(
        policy.can_administer,
        "the owner really administers this repo"
    );
    assert!(!policy.delete_branch_on_merge);
    assert_eq!(policy.default_method.as_deref(), Some("merge"));
}

#[test]
fn repo_rest_capture_reports_auto_merge_off() {
    let mut policy = MergePolicy::default();
    apply_repo_rest(&mut policy, &fixture("repo-rest.json"));
    assert!(
        !policy.auto_merge_allowed,
        "allow_auto_merge is false on this repo"
    );
}

#[test]
fn rate_limit_capture_reads_the_core_window() {
    let limit = rate_limit_from_json(&fixture("rate-limit.json")).expect("core window present");
    assert_eq!(limit.limit, 5000);
    assert!(limit.remaining <= limit.limit);
    assert!(limit.reset > 0);
}

#[test]
fn label_list_capture_maps_the_default_labels() {
    let labels = labels_from_json(&fixture("label-list.json"));
    assert_eq!(labels.len(), 9, "GitHub's nine default labels");
    assert_eq!(labels[0].name, "bug");
    assert_eq!(labels[0].color, "d73a4a");
    assert!(labels.iter().all(|l| !l.color.is_empty()));
}

#[test]
fn run_list_capture_includes_a_real_in_progress_run() {
    let rows = fixture("run-list.json");
    let rows = rows.as_array().expect("run list is an array");
    assert_eq!(rows.len(), 10);
    let items: Vec<RunListItem> = rows.iter().map(run_list_item_from_json).collect();
    for item in &items {
        assert!(item.database_id > 0);
        assert!(!item.status.is_empty());
        assert!(item.url.starts_with("https://"));
    }
    // Live-observed quirk this capture pins down: an in-progress run arrives
    // with `"conclusion": ""` (empty string, not null) and must map to `None`.
    let in_progress = items
        .iter()
        .find(|r| r.status == "in_progress")
        .expect("the capture holds an in-progress run");
    assert_eq!(in_progress.conclusion, None);
    assert!(items
        .iter()
        .any(|r| r.conclusion.as_deref() == Some("success")));
}

#[test]
fn issue_list_capture_is_the_honest_empty_case() {
    // This repo genuinely has no issues; an empty array must parse to an empty
    // list (the UI's empty state), not an error.
    let rows = fixture("issue-list.json");
    let rows = rows.as_array().expect("issue list is an array");
    let items: Vec<IssueListItem> = rows.iter().map(issue_list_item_from_json).collect();
    assert!(items.is_empty());
}
