//! CLI-contract tests: the **production `gh` layer** driven end to end through a
//! real child process — a scripted stand-in `gh` installed on `PATH` — with no
//! network and no account.
//!
//! The unit and fixture tests prove the *parsers*; this file proves the
//! *runner*: that `github::pr_merge` & co. spawn `gh`, pass the argv and the
//! non-interactive environment, and surface gh's own stdout/stderr/exit —
//! verbatim — as the app's result. The stand-in's answers come from
//! `tests/fixtures/github/mutation-outcomes.json`, each case modeled on gh's
//! real output format with its provenance recorded in the fixture itself (and
//! re-verified against the real thing by the supervised live suite,
//! `tests/github_live.rs`).
//!
//! Two things make this an integration test rather than a long-winded unit
//! test: it uses only the crate's public surface, and the child process is
//! real — `PATH` resolution, `.cmd` handling on Windows, stderr capture and
//! exit codes are the actual OS mechanisms, not mocks.
//!
//! `PATH` is process-global, so every test serializes on [`PATH_LOCK`] and
//! restores the original value on drop. The shim directory contains **only**
//! the stand-in: on Unix `PATH` is the shim directory alone; on Windows it
//! adds the system directories (a `.cmd` runs through `cmd.exe`) — which hold
//! no developer CLIs, so nothing can escape to a real `gh`.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use uxnan_desktop_lib::error::AppError;
use uxnan_desktop_lib::github;

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

static PATH_LOCK: Mutex<()> = Mutex::new(());

/// Restores the original `PATH` when the test is done (or panics).
struct ShimGuard {
    original: Option<std::ffi::OsString>,
    _lock: MutexGuard<'static, ()>,
}

impl Drop for ShimGuard {
    fn drop(&mut self) {
        match &self.original {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
    }
}

/// Point `PATH` at `dir` (plus, on Windows, the system directories `cmd.exe`
/// lives in). Serialized: `PATH` is process state.
fn use_path(dir: &Path) -> ShimGuard {
    let lock = PATH_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let original = std::env::var_os("PATH");
    let mut parts: Vec<PathBuf> = vec![dir.to_path_buf()];
    #[cfg(windows)]
    {
        let root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        parts.push(root.join("System32"));
        parts.push(root);
    }
    // On Unix nothing else is needed: the shim runs via its shebang, which the
    // kernel resolves without consulting PATH — and leaving `/usr/bin` out
    // means a real `gh` (CI runners ship one) can never be reached by mistake.
    let joined = std::env::join_paths(parts).expect("paths join");
    std::env::set_var("PATH", &joined);
    ShimGuard {
        original,
        _lock: lock,
    }
}

/// Write a `gh` stand-in into `dir` that records its argv and key env vars,
/// prints the given stdout/stderr and exits with `code`.
fn write_shim(dir: &Path, stdout: &str, stderr: &str, code: i32) {
    std::fs::create_dir_all(dir).expect("shim dir");
    std::fs::write(dir.join("gh-stdout.txt"), stdout).expect("stdout file");
    std::fs::write(dir.join("gh-stderr.txt"), stderr).expect("stderr file");
    #[cfg(windows)]
    {
        let script = format!(
            "@echo off\r\n\
             echo %* > \"%~dp0gh-args.txt\"\r\n\
             echo GH_PROMPT_DISABLED=%GH_PROMPT_DISABLED% GH_PAGER=[%GH_PAGER%] > \"%~dp0gh-env.txt\"\r\n\
             type \"%~dp0gh-stdout.txt\"\r\n\
             type \"%~dp0gh-stderr.txt\" 1>&2\r\n\
             exit /b {code}\r\n"
        );
        std::fs::write(dir.join("gh.cmd"), script).expect("gh.cmd");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let script = format!(
            "#!/bin/sh\nd=\"$(dirname \"$0\")\"\nprintf '%s ' \"$@\" > \"$d/gh-args.txt\"\n\
             printf 'GH_PROMPT_DISABLED=%s GH_PAGER=[%s]' \"$GH_PROMPT_DISABLED\" \"$GH_PAGER\" > \"$d/gh-env.txt\"\n\
             cat \"$d/gh-stdout.txt\"\ncat \"$d/gh-stderr.txt\" >&2\nexit {code}\n"
        );
        let path = dir.join("gh");
        std::fs::write(&path, script).expect("gh shim");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
}

/// One canned outcome from `tests/fixtures/github/mutation-outcomes.json`.
struct Outcome {
    exit: i32,
    stdout: String,
    stderr: String,
}

fn outcomes() -> &'static serde_json::Value {
    static CACHE: OnceLock<serde_json::Value> = OnceLock::new();
    CACHE.get_or_init(|| {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/github/mutation-outcomes.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        serde_json::from_str(&text).expect("mutation-outcomes.json is valid JSON")
    })
}

fn outcome(id: &str) -> Outcome {
    let case = outcomes()
        .get("cases")
        .and_then(|c| c.as_array())
        .and_then(|cases| {
            cases
                .iter()
                .find(|c| c.get("id").and_then(|i| i.as_str()) == Some(id))
        })
        .unwrap_or_else(|| panic!("no case {id:?} in mutation-outcomes.json"));
    Outcome {
        exit: case.get("exit").and_then(|e| e.as_i64()).unwrap_or(1) as i32,
        stdout: case
            .get("stdout")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        stderr: case
            .get("stderr")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

/// A shim directory answering with one canned outcome, plus a worktree dir for
/// the repo-scoped commands to `cd` into.
fn stage(tmp: &tempfile::TempDir, id: &str) -> (PathBuf, String) {
    let shim = tmp.path().join("bin");
    let case = outcome(id);
    write_shim(&shim, &case.stdout, &case.stderr, case.exit);
    let work = tmp.path().join("work");
    std::fs::create_dir_all(&work).expect("work dir");
    (shim, work.to_string_lossy().to_string())
}

fn github_err(result: Result<impl std::fmt::Debug, AppError>) -> String {
    match result {
        Err(AppError::Github(msg)) => msg,
        other => panic!("expected AppError::Github, got {other:?}"),
    }
}

fn merge_opts(json: serde_json::Value) -> github::PrMergeOptions {
    serde_json::from_value(json).expect("merge options")
}

// ---------------------------------------------------------------------------
// merge outcomes
// ---------------------------------------------------------------------------

/// Every refusal gh can answer a merge with must reach the UI as gh's own
/// sentence — that message (policy, behind, conflicts, stale head, draft) is
/// the actionable part, and exit-0-means-success must never be assumed the
/// other way around.
#[tokio::test]
async fn merge_refusals_surface_ghs_own_explanation() {
    let table = [
        (
            "merge-blocked-policy",
            r#"{"method":"squash"}"#,
            "the base branch policy prohibits the merge",
        ),
        (
            "merge-blocked-behind",
            r#"{"method":"squash"}"#,
            "not up to date with the base branch",
        ),
        (
            "merge-conflicting",
            r#"{"method":"merge"}"#,
            "cannot be cleanly created",
        ),
        (
            "merge-stale-head",
            r#"{"method":"squash","matchHeadCommit":"0123456789abcdef0123456789abcdef01234567"}"#,
            "Head branch was modified",
        ),
        ("merge-draft", r#"{"method":"squash"}"#, "draft"),
        (
            "merge-auto-not-allowed",
            r#"{"method":"squash","auto":true}"#,
            "Auto merge is not allowed",
        ),
    ];
    for (id, opts, needle) in table {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (shim, work) = stage(&tmp, id);
        let _guard = use_path(&shim);
        let opts = merge_opts(serde_json::from_str(opts).expect("opts json"));
        let msg = github_err(github::pr_merge(&work, "7", opts).await);
        assert!(
            msg.contains(needle),
            "{id}: expected {needle:?} in gh's message, got {msg:?}"
        );
    }
}

#[tokio::test]
async fn accepted_merges_and_armed_auto_merge_report_ok() {
    for (id, opts) in [
        ("merge-auto-armed", r#"{"method":"squash","auto":true}"#),
        (
            "merge-admin-success",
            r#"{"method":"squash","admin":true,"matchHeadCommit":"0123456789abcdef0123456789abcdef01234567"}"#,
        ),
    ] {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (shim, work) = stage(&tmp, id);
        let _guard = use_path(&shim);
        let opts = merge_opts(serde_json::from_str(opts).expect("opts json"));
        github::pr_merge(&work, "7", opts)
            .await
            .unwrap_or_else(|e| panic!("{id}: expected success, got {e:?}"));
    }
}

// ---------------------------------------------------------------------------
// create / review
// ---------------------------------------------------------------------------

#[tokio::test]
async fn pr_create_returns_the_new_urls_from_stdout() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let (shim, work) = stage(&tmp, "create-success");
    let _guard = use_path(&shim);
    let opts: github::PrCreateOptions = serde_json::from_str(
        r#"{"title":"Exercise the merge surface","body":"b","base":"main","head":"feat/x"}"#,
    )
    .expect("create options");
    let url = github::pr_create(&work, opts).await.expect("create ok");
    assert_eq!(url, "https://github.com/luisgamas/uxnan-gh-sandbox/pull/7");
}

#[tokio::test]
async fn pr_create_with_no_commits_surfaces_the_graphql_refusal() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let (shim, work) = stage(&tmp, "create-no-commits");
    let _guard = use_path(&shim);
    let opts: github::PrCreateOptions =
        serde_json::from_str(r#"{"title":"t","body":"b","base":"main","head":"feat/empty"}"#)
            .expect("create options");
    let msg = github_err(github::pr_create(&work, opts).await);
    assert!(msg.contains("No commits between"), "got {msg:?}");
}

#[tokio::test]
async fn approving_your_own_pr_surfaces_the_refusal() {
    // The single-account limit the sandbox docs call out: GitHub refuses
    // self-approval, and the message must reach the user untouched.
    let tmp = tempfile::tempdir().expect("tempdir");
    let (shim, work) = stage(&tmp, "review-own-pr-approve");
    let _guard = use_path(&shim);
    let msg = github_err(github::pr_review(&work, "7", "approve", None).await);
    assert!(
        msg.contains("Can not approve your own pull request"),
        "got {msg:?}"
    );
}

// ---------------------------------------------------------------------------
// degraded environments
// ---------------------------------------------------------------------------

#[tokio::test]
async fn truncated_json_reads_as_invalid_json_not_a_panic() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let (shim, work) = stage(&tmp, "partial-json");
    let _guard = use_path(&shim);
    let msg = github_err(github::pr_list(&work, "open", None, 50).await);
    assert!(msg.contains("invalid gh JSON"), "got {msg:?}");
}

#[tokio::test]
async fn signed_out_offline_and_rate_limited_reads_stay_actionable() {
    for (id, needle) in [
        ("logged-out", "gh auth login"),
        ("offline", "check your internet connection"),
        ("rate-limited", "API rate limit exceeded"),
        ("not-a-github-remote", "no git remotes found"),
    ] {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (shim, work) = stage(&tmp, id);
        let _guard = use_path(&shim);
        let msg = github_err(github::pr_list(&work, "open", None, 50).await);
        assert!(msg.contains(needle), "{id}: got {msg:?}");
    }
}

#[tokio::test]
async fn an_old_gh_rejecting_a_json_field_is_surfaced() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let (shim, work) = stage(&tmp, "old-gh-unknown-json-field");
    let _guard = use_path(&shim);
    let msg = github_err(github::pr_view(&work, "7").await);
    assert!(msg.contains("Unknown JSON field"), "got {msg:?}");
}

/// `status()` must degrade through its whole chain on an old gh: the `--json`
/// probe fails with "unknown flag", and the prose fallback then parses the
/// captured real banner — all through real child processes.
#[tokio::test]
async fn status_falls_back_to_prose_on_a_gh_without_json_auth_status() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let shim = tmp.path().join("bin");
    std::fs::create_dir_all(&shim).expect("shim dir");
    // The prose the fallback parses is the *captured real* banner.
    let banner_fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/github/auth-status-text.json");
    let wrapper: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&banner_fixture).expect("auth banner fixture"),
    )
    .expect("fixture json");
    let banner = wrapper
        .get("payloadText")
        .and_then(|t| t.as_str())
        .expect("payloadText")
        .to_string();
    let unknown_flag = outcome("old-gh-unknown-flag");
    std::fs::write(shim.join("gh-json-stderr.txt"), &unknown_flag.stderr).expect("stderr file");
    std::fs::write(shim.join("gh-prose-stdout.txt"), &banner).expect("banner file");
    #[cfg(windows)]
    {
        let script = "@echo off\r\n\
             echo %* | findstr /C:\"--json\" >nul\r\n\
             if not errorlevel 1 (\r\n\
               type \"%~dp0gh-json-stderr.txt\" 1>&2\r\n\
               exit /b 1\r\n\
             )\r\n\
             type \"%~dp0gh-prose-stdout.txt\"\r\n\
             exit /b 0\r\n";
        std::fs::write(shim.join("gh.cmd"), script).expect("gh.cmd");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let script = "#!/bin/sh\nd=\"$(dirname \"$0\")\"\ncase \" $* \" in\n\
             *\" --json \"*) cat \"$d/gh-json-stderr.txt\" >&2; exit 1 ;;\n\
             *) cat \"$d/gh-prose-stdout.txt\"; exit 0 ;;\nesac\n";
        let path = shim.join("gh");
        std::fs::write(&path, script).expect("gh shim");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    let _guard = use_path(&shim);
    let status = github::status().await;
    assert!(status.gh_installed);
    assert!(
        status.authenticated,
        "prose fallback must still sign in: {status:?}"
    );
    assert_eq!(status.login.as_deref(), Some("luisgamas"));
    assert_eq!(status.scopes.len(), 5);
}

// ---------------------------------------------------------------------------
// resolution + environment
// ---------------------------------------------------------------------------

/// The demonstrated Windows failure this suite exists to pin down: a `gh`
/// installed as a `.cmd` shim passed the install probe (`which` honors
/// `PATHEXT`) but `Command::new("gh")` only searches for `gh.exe`, so every
/// actual call failed with "program not found". Production now resolves the
/// concrete path first; this test runs the whole chain through a `.cmd` on
/// Windows (and a plain script elsewhere).
#[tokio::test]
async fn a_cmd_installed_gh_works_like_the_install_probe_says() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let shim = tmp.path().join("bin");
    write_shim(&shim, "[]", "", 0);
    let work = tmp.path().join("work");
    std::fs::create_dir_all(&work).expect("work dir");
    let _guard = use_path(&shim);
    assert!(github::gh_installed(), "the probe sees the shim");
    let rows = github::pr_list(work.to_string_lossy().as_ref(), "open", None, 50)
        .await
        .expect("the spawn must agree with the probe");
    assert!(rows.is_empty());
}

#[tokio::test]
async fn a_missing_gh_degrades_cleanly_everywhere() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let empty = tmp.path().join("bin");
    std::fs::create_dir_all(&empty).expect("empty dir");
    let work = tmp.path().join("work");
    std::fs::create_dir_all(&work).expect("work dir");
    let _guard = use_path(&empty);
    let status = github::status().await;
    assert!(!status.gh_installed);
    assert!(!status.authenticated);
    assert!(status.message.is_some(), "the connect state needs its hint");
    // A direct call without the probe still fails as a github error, not a hang.
    let result = github::pr_list(work.to_string_lossy().as_ref(), "open", None, 50).await;
    assert!(matches!(result, Err(AppError::Github(_))), "got {result:?}");
}

#[tokio::test]
async fn the_child_gets_the_non_interactive_env_and_the_argv() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let (shim, work) = stage(&tmp, "partial-json");
    let _guard = use_path(&shim);
    let _ = github::pr_list(&work, "open", Some("is:draft"), 50).await;
    let args = std::fs::read_to_string(shim.join("gh-args.txt")).expect("args recorded");
    assert!(args.contains("pr list"), "argv reached the child: {args:?}");
    assert!(
        args.contains("--search"),
        "search fragment passed: {args:?}"
    );
    let env = std::fs::read_to_string(shim.join("gh-env.txt")).expect("env recorded");
    assert!(
        env.contains("GH_PROMPT_DISABLED=1"),
        "prompts disabled: {env:?}"
    );
    assert!(
        env.contains("GH_PAGER=[]"),
        "pager blanked, so nothing can hang: {env:?}"
    );
}
