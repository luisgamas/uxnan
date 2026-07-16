//! GitHub integration — a `gh`-CLI-backed layer for the ADE's GitHub section,
//! the worktree-scoped PR/CI panel, and the PR/issue/Actions center tabs.
//!
//! # Posture
//! Every call shells out to the **GitHub CLI (`gh`)** — including `gh api` for the
//! few endpoints without a dedicated subcommand (rate limit, notifications). This
//! matches the ADE's terminal-centric principle (it already drives local CLIs) and
//! has three consequences we rely on:
//! - **No token ever touches this process.** `gh` owns the OAuth token in the OS
//!   keychain; we only ever read sanitized status (login/scopes/host). We never
//!   pass `--show-token` and never store a secret.
//! - **The manual path == the agent path.** Anything an agent could automate here
//!   is the same `gh` command a human triggers, so GitHub features keep working
//!   with zero agent quota.
//! - **Minimal surface.** No provider SDK, no bundled API client.
//!
//! `gh` resolves the repo from the working directory, so repo-scoped calls run with
//! `current_dir` set to the worktree path. **WSL repos are a known gap:** a Windows
//! `gh` can't see a `\\wsl.localhost\…` checkout, so GitHub features degrade to
//! "not a GitHub repo" there (tracked in `FOR-DEV.md`). Native conditional-request
//! polling (ETag/304) is a deferred optimization; today the status layer just calls
//! `gh` on a throttled, focus-paused interval like the git watcher.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Hard timeout for any single `gh` invocation. Generous enough for a slow PR diff
/// / log download, but bounded so the UI can never hang on a stalled call.
const GH_TIMEOUT: Duration = Duration::from_secs(60);

/// Fields requested from `gh pr view` for a worktree's current-branch PR summary.
const PR_SUMMARY_FIELDS: &str =
    "number,title,state,isDraft,url,mergeable,reviewDecision,statusCheckRollup,headRefName";

/// Fields requested from `gh pr list`. Includes `statusCheckRollup` so each row can
/// show a CI status icon + a checks-summary popover without a per-row extra call.
const PR_LIST_FIELDS: &str = "number,title,state,isDraft,url,author,headRefName,\
    baseRefName,reviewDecision,updatedAt,statusCheckRollup";

/// Fields requested from `gh pr view <n>` for the full review tab. Kept to fields
/// valid across gh versions/GHES — a single unknown field makes gh reject the whole
/// call (that's what left the PR detail stuck "loading"). `mergeStateStatus` is
/// intentionally omitted (newer-gh only); `mergeable` covers the mergeability hint.
const PR_DETAIL_FIELDS: &str =
    "number,title,body,state,isDraft,url,author,baseRefName,headRefName,\
    additions,deletions,changedFiles,mergeable,reviewDecision,files,\
    statusCheckRollup,labels,assignees,createdAt,updatedAt,\
    comments,commits,reviews,reviewRequests";

/// Fields requested from `gh issue list`.
const ISSUE_LIST_FIELDS: &str = "number,title,state,url,author,labels,assignees,updatedAt,comments";

/// Fields requested from `gh issue view <n>`.
const ISSUE_DETAIL_FIELDS: &str =
    "number,title,body,state,url,author,labels,assignees,createdAt,updatedAt,comments";

/// Fields requested from `gh run list`.
const RUN_LIST_FIELDS: &str = "databaseId,name,displayTitle,status,conclusion,headBranch,\
    workflowName,event,createdAt,url";

// ---------------------------------------------------------------------------
// gh runner
// ---------------------------------------------------------------------------

/// Whether `gh` is installed and resolvable on `PATH`.
pub fn gh_installed() -> bool {
    crate::which::is_command_available("gh")
}

/// Run `gh` (windowless on Windows) with an optional working directory, returning
/// trimmed stdout on success. A non-zero exit maps to [`AppError::Github`] carrying
/// the trimmed stderr. `dir` scopes repo-relative commands to a worktree.
async fn gh(dir: Option<&str>, args: &[&str]) -> Result<String, AppError> {
    let mut cmd = crate::winproc::command("gh");
    if let Some(dir) = dir {
        cmd.current_dir(dir);
    }
    // Keep gh non-interactive so a subprocess can never block the UI:
    // - no prompts / update notifier;
    // - **no pager** — `gh pr diff` / `gh run view --log` default to a pager, which
    //   waits for input and hangs a captured child (the "detail stuck loading" bug).
    //   A blank `GH_PAGER` disables paging entirely (gh writes straight to stdout).
    // `output()` already closes stdin and captures stdout/stderr; `kill_on_drop`
    // lets the timeout below actually terminate a stalled call.
    cmd.env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_PAGER", "")
        .env("PAGER", "")
        .kill_on_drop(true);
    cmd.args(args);
    // Hard ceiling so a stalled call can never leave the UI stuck loading.
    let output = match tokio::time::timeout(GH_TIMEOUT, cmd.output()).await {
        Ok(res) => res.map_err(|e| AppError::Github(e.to_string()))?,
        Err(_) => {
            return Err(AppError::Github(format!(
                "gh timed out after {}s",
                GH_TIMEOUT.as_secs()
            )));
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let msg = if stderr.is_empty() {
            format!("gh exited with status {}", output.status)
        } else {
            stderr
        };
        return Err(AppError::Github(msg));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run `gh` and parse stdout as JSON.
async fn gh_json(dir: Option<&str>, args: &[&str]) -> Result<serde_json::Value, AppError> {
    let out = gh(dir, args).await?;
    serde_json::from_str(&out).map_err(|e| AppError::Github(format!("invalid gh JSON: {e}")))
}

/// Reject a value that isn't a plain non-negative integer, so it can never be an
/// arg-injection vector when interpolated into a `gh`/`git` invocation.
pub fn validate_number(n: &str) -> Result<String, AppError> {
    let n = n.trim();
    if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) {
        Ok(n.to_string())
    } else {
        Err(AppError::Invalid(format!("invalid number: {n:?}")))
    }
}

// ---------------------------------------------------------------------------
// Auth / status
// ---------------------------------------------------------------------------

/// Sanitized GitHub sign-in status for the Account/Session panel and the section
/// gate. **Never** carries the token.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    /// Whether the `gh` CLI is installed on this machine.
    pub gh_installed: bool,
    /// Whether `gh` reports an authenticated account.
    pub authenticated: bool,
    /// The signed-in login, when known.
    pub login: Option<String>,
    /// The host (`github.com` or a GHES hostname), when known.
    pub host: Option<String>,
    /// OAuth token scopes reported by `gh auth status` (never the token itself).
    pub scopes: Vec<String>,
    /// A human-readable hint when not installed / not signed in.
    pub message: Option<String>,
}

/// Read the current GitHub sign-in status via `gh auth status`. Purely
/// informational — no network mutation, no token exposure.
pub async fn status() -> GithubStatus {
    if !gh_installed() {
        return GithubStatus {
            gh_installed: false,
            authenticated: false,
            login: None,
            host: None,
            scopes: Vec::new(),
            message: Some("GitHub CLI (`gh`) is not installed".to_string()),
        };
    }
    // `gh auth status` prints to stdout on success and stderr when logged out; on
    // some versions it's the reverse. Capture both and parse whatever we got. Same
    // non-interactive env + timeout as `gh()` so a stalled status probe can't wedge
    // the whole section (`available` gates the lists on it).
    let mut cmd = crate::winproc::command("gh");
    cmd.env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_PAGER", "")
        .env("PAGER", "")
        .kill_on_drop(true)
        .args(["auth", "status"]);
    let result = tokio::time::timeout(GH_TIMEOUT, cmd.output()).await;
    let combined = match result {
        Ok(Ok(out)) => {
            let mut s = String::from_utf8_lossy(&out.stdout).to_string();
            s.push('\n');
            s.push_str(&String::from_utf8_lossy(&out.stderr));
            s
        }
        Ok(Err(e)) => {
            return GithubStatus {
                gh_installed: true,
                authenticated: false,
                login: None,
                host: None,
                scopes: Vec::new(),
                message: Some(e.to_string()),
            };
        }
        Err(_) => {
            return GithubStatus {
                gh_installed: true,
                authenticated: false,
                login: None,
                host: None,
                scopes: Vec::new(),
                message: Some("`gh auth status` timed out".to_string()),
            };
        }
    };
    match parse_auth_status(&combined) {
        Some(parsed) => GithubStatus {
            gh_installed: true,
            authenticated: true,
            login: Some(parsed.login),
            host: Some(parsed.host),
            scopes: parsed.scopes,
            message: None,
        },
        None => GithubStatus {
            gh_installed: true,
            authenticated: false,
            login: None,
            host: None,
            scopes: Vec::new(),
            message: Some("Not signed in — run `gh auth login`".to_string()),
        },
    }
}

/// The bits parsed out of `gh auth status`.
#[derive(Debug, PartialEq, Eq)]
struct AuthStatus {
    host: String,
    login: String,
    scopes: Vec<String>,
}

/// Parse `gh auth status` output. Recognizes the "Logged in to `<host>` account
/// `<login>`" line (current gh) and the older "Logged in to `<host>` as `<login>`"
/// phrasing, plus the "Token scopes: 'a', 'b'" line. Pure, so it's unit-tested
/// against real gh output shapes. Returns `None` when no logged-in line is found.
fn parse_auth_status(output: &str) -> Option<AuthStatus> {
    let mut host: Option<String> = None;
    let mut login: Option<String> = None;
    let mut scopes: Vec<String> = Vec::new();
    for raw in output.lines() {
        let line = raw.trim().trim_start_matches(['✓', '-', '*', ' ']).trim();
        if let Some(rest) = line.strip_prefix("Logged in to ") {
            // "<host> account <login> (...)" or "<host> as <login> (...)"
            let mut it = rest.split_whitespace();
            if let Some(h) = it.next() {
                host.get_or_insert(h.to_string());
            }
            if let Some(sep) = it.next() {
                if (sep == "account" || sep == "as") && login.is_none() {
                    if let Some(user) = it.next() {
                        login = Some(user.trim_matches(['(', ')']).to_string());
                    }
                }
            }
        } else if let Some(rest) = line.strip_prefix("Token scopes:") {
            scopes = rest
                .split(',')
                .map(|s| s.trim().trim_matches(['\'', '"', ' ']).to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }
    match (host, login) {
        (Some(host), Some(login)) => Some(AuthStatus {
            host,
            login,
            scopes,
        }),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Repo context (worktree-scoped)
// ---------------------------------------------------------------------------

/// A rolled-up CI checks summary for a PR, for the compact status badge.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CheckSummary {
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub pending: u32,
    /// One-word roll-up: `"success" | "failure" | "pending" | "none"`.
    pub state: String,
}

/// A single check/status row (for the PR review tab + the right-panel drill-down).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    pub name: String,
    /// Normalized bucket: `"pass" | "fail" | "pending" | "skip"`.
    pub bucket: String,
    pub link: Option<String>,
    pub workflow: Option<String>,
}

/// The active worktree's GitHub context: which repo it points at, its branch, and
/// the PR for that branch (if any) with a checks roll-up.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoContext {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub name_with_owner: String,
    pub branch: Option<String>,
    pub pr: Option<PrSummary>,
}

/// A compact PR summary for the worktree card / right-panel tab.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrSummary {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub is_draft: bool,
    pub url: String,
    pub review_decision: Option<String>,
    pub mergeable: Option<String>,
    pub checks: CheckSummary,
}

/// Resolve the GitHub context for a worktree path. Returns `None` when it isn't a
/// GitHub repo (no `github.com`/GHES origin, or a WSL path `gh` can't see).
pub async fn repo_context(worktree_path: &str) -> Option<RepoContext> {
    let owner = crate::git::remote_owner(worktree_path).await?;
    // Only GitHub hosts (github.com or a GHES host gh is configured for). We accept
    // any host here and let the PR probe fail gracefully for non-GitHub remotes.
    let repo = repo_name_from_remote(worktree_path).await?;
    let branch = crate::git::current_branch(worktree_path)
        .await
        .ok()
        .filter(|b| !b.is_empty() && b != "HEAD");
    let pr = pr_summary_for_current(worktree_path).await;
    Some(RepoContext {
        name_with_owner: format!("{}/{}", owner.owner, repo),
        host: owner.host,
        owner: owner.owner,
        repo,
        branch,
        pr,
    })
}

/// The repo name (second path segment) from `origin`, e.g. `uxnan` from
/// `git@github.com:luisgamas/uxnan.git`.
async fn repo_name_from_remote(worktree_path: &str) -> Option<String> {
    let url = crate::git::remote_url(worktree_path, "origin").await.ok()?;
    parse_repo_name(url.trim())
}

/// Parse the repo name (the segment after the owner) from a remote URL. Pure.
fn parse_repo_name(url: &str) -> Option<String> {
    if url.is_empty() {
        return None;
    }
    let tail = url.rsplit(['/', ':']).next()?;
    let name = tail.trim_end_matches(".git").trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// The PR for the worktree's current branch, if one exists. Best-effort: any gh
/// error (no PR, not a repo, WSL) collapses to `None`.
async fn pr_summary_for_current(worktree_path: &str) -> Option<PrSummary> {
    let v = gh_json(
        Some(worktree_path),
        &["pr", "view", "--json", PR_SUMMARY_FIELDS],
    )
    .await
    .ok()?;
    Some(pr_summary_from_json(&v))
}

/// Map a `gh pr view --json` object into a [`PrSummary`].
fn pr_summary_from_json(v: &serde_json::Value) -> PrSummary {
    PrSummary {
        number: v.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
        title: str_field(v, "title"),
        state: str_field(v, "state"),
        is_draft: v.get("isDraft").and_then(|b| b.as_bool()).unwrap_or(false),
        url: str_field(v, "url"),
        review_decision: opt_str_field(v, "reviewDecision"),
        mergeable: opt_str_field(v, "mergeable"),
        checks: check_summary_from_rollup(v.get("statusCheckRollup")),
    }
}

// ---------------------------------------------------------------------------
// Checks roll-up
// ---------------------------------------------------------------------------

/// Classify a single `statusCheckRollup` entry into a bucket, handling both
/// CheckRun (`status`/`conclusion`) and StatusContext (`state`) shapes. Pure.
fn classify_check(entry: &serde_json::Value) -> &'static str {
    // StatusContext: has a `state` (SUCCESS/FAILURE/ERROR/PENDING/EXPECTED).
    if let Some(state) = entry.get("state").and_then(|s| s.as_str()) {
        return match state.to_ascii_uppercase().as_str() {
            "SUCCESS" => "pass",
            "FAILURE" | "ERROR" => "fail",
            "PENDING" | "EXPECTED" => "pending",
            _ => "skip",
        };
    }
    // CheckRun: COMPLETED + a conclusion, else in-progress/queued → pending.
    let status = entry
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    if status != "COMPLETED" {
        return "pending";
    }
    match entry
        .get("conclusion")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_ascii_uppercase()
        .as_str()
    {
        "SUCCESS" => "pass",
        "FAILURE" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED" | "STARTUP_FAILURE" => "fail",
        "NEUTRAL" | "SKIPPED" | "STALE" => "skip",
        _ => "pending",
    }
}

/// Roll a `statusCheckRollup` array up into counts + an overall state. Pure.
fn check_summary_from_rollup(rollup: Option<&serde_json::Value>) -> CheckSummary {
    let mut s = CheckSummary::default();
    let Some(arr) = rollup.and_then(|v| v.as_array()) else {
        s.state = "none".to_string();
        return s;
    };
    for entry in arr {
        s.total += 1;
        match classify_check(entry) {
            "pass" => s.passed += 1,
            "fail" => s.failed += 1,
            "pending" => s.pending += 1,
            _ => s.passed += 1, // skip/neutral counts as non-blocking
        }
    }
    s.state = if s.total == 0 {
        "none"
    } else if s.failed > 0 {
        "failure"
    } else if s.pending > 0 {
        "pending"
    } else {
        "success"
    }
    .to_string();
    s
}

/// Expand a `statusCheckRollup` array into individual rows for the review tab.
fn check_items_from_rollup(rollup: Option<&serde_json::Value>) -> Vec<CheckItem> {
    let Some(arr) = rollup.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .map(|e| CheckItem {
            name: e
                .get("name")
                .and_then(|v| v.as_str())
                .or_else(|| e.get("context").and_then(|v| v.as_str()))
                .unwrap_or("check")
                .to_string(),
            bucket: classify_check(e).to_string(),
            link: e
                .get("detailsUrl")
                .and_then(|v| v.as_str())
                .or_else(|| e.get("targetUrl").and_then(|v| v.as_str()))
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
            workflow: opt_str_field(e, "workflowName"),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

/// One row in the PR list (section + right panel).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrListItem {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub is_draft: bool,
    pub url: String,
    pub author: Option<String>,
    pub head_ref_name: Option<String>,
    pub base_ref_name: Option<String>,
    pub review_decision: Option<String>,
    pub updated_at: Option<String>,
    /// CI roll-up for the row's status icon.
    pub checks_summary: CheckSummary,
    /// The individual checks (already in the `statusCheckRollup` payload), so the
    /// row's popover can list them without a per-row extra call.
    pub checks: Vec<CheckItem>,
}

/// List PRs for a repo (resolved from `worktree_path`'s origin). `search` is an
/// optional GitHub search fragment; `state` is `open|closed|merged|all`.
pub async fn pr_list(
    worktree_path: &str,
    state: &str,
    search: Option<&str>,
    limit: u32,
) -> Result<Vec<PrListItem>, AppError> {
    let limit = limit.clamp(1, 100).to_string();
    let state = normalize_state(state);
    let mut args = vec![
        "pr",
        "list",
        "--json",
        PR_LIST_FIELDS,
        "--state",
        state,
        "--limit",
        &limit,
    ];
    if let Some(s) = search.map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--search");
        args.push(s);
    }
    let v = gh_json(Some(worktree_path), &args).await?;
    Ok(v.as_array()
        .map(|arr| arr.iter().map(pr_list_item_from_json).collect())
        .unwrap_or_default())
}

fn pr_list_item_from_json(v: &serde_json::Value) -> PrListItem {
    PrListItem {
        number: v.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
        title: str_field(v, "title"),
        state: str_field(v, "state"),
        is_draft: v.get("isDraft").and_then(|b| b.as_bool()).unwrap_or(false),
        url: str_field(v, "url"),
        author: login_field(v, "author"),
        head_ref_name: opt_str_field(v, "headRefName"),
        base_ref_name: opt_str_field(v, "baseRefName"),
        review_decision: opt_str_field(v, "reviewDecision"),
        updated_at: opt_str_field(v, "updatedAt"),
        checks_summary: check_summary_from_rollup(v.get("statusCheckRollup")),
        checks: check_items_from_rollup(v.get("statusCheckRollup")),
    }
}

/// Full PR detail for the review center tab (metadata + files + checks). The diff
/// is fetched separately via [`pr_diff`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDetail {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub is_draft: bool,
    pub url: String,
    pub author: Option<String>,
    pub base_ref_name: Option<String>,
    pub head_ref_name: Option<String>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub mergeable: Option<String>,
    pub merge_state_status: Option<String>,
    pub review_decision: Option<String>,
    /// When the PR was opened — the timestamp on the timeline's opening bubble.
    pub created_at: Option<String>,
    /// When the PR was last updated (for the "edited N ago" hint).
    pub updated_at: Option<String>,
    pub labels: Vec<String>,
    pub files: Vec<PrFile>,
    pub checks: Vec<CheckItem>,
    pub checks_summary: CheckSummary,
    /// Requested reviewers (logins / team names), for the reviewers row.
    pub reviewers: Vec<String>,
    /// Submitted reviews (approve / request-changes / comment, incl. agent bots).
    pub reviews: Vec<PrReview>,
    /// Conversation comments (issue-level comments on the PR).
    pub comments: Vec<PrComment>,
    /// The PR's commits (newest first as gh returns them).
    pub commits: Vec<PrCommit>,
}

/// A changed file within a PR.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFile {
    pub path: String,
    pub additions: u64,
    pub deletions: u64,
}

/// A submitted PR review (approve/request-changes/comment). `state` is uppercase
/// (`APPROVED` / `CHANGES_REQUESTED` / `COMMENTED` / `DISMISSED`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReview {
    pub author: Option<String>,
    pub state: String,
    pub body: String,
    pub submitted_at: Option<String>,
}

/// An issue-level comment on the PR (the conversation).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub author: Option<String>,
    pub body: String,
    pub created_at: Option<String>,
}

/// A commit within the PR.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCommit {
    /// Full commit hash.
    pub oid: String,
    pub message: String,
    pub author: Option<String>,
    pub committed_at: Option<String>,
}

/// One normalized entry in a PR/issue **timeline** (GitHub's Timeline Events API,
/// `GET /repos/{owner}/{repo}/issues/{n}/timeline`). Every rendered event kind is
/// flattened into this shape; the frontend renders an icon + verb per `event`.
/// Only fields relevant to a given kind are populated (the rest are `None`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    /// The event kind, e.g. `commented`, `reviewed`, `committed`, `labeled`,
    /// `assigned`, `closed`, `merged`, `reopened`, `renamed`, `review_requested`,
    /// `head_ref_force_pushed`, `cross-referenced`, `ready_for_review`, …
    pub event: String,
    /// Who performed the action (a GitHub login, or a git author name for commits).
    pub actor: Option<String>,
    /// ISO-8601 timestamp used to sort the timeline.
    pub created_at: Option<String>,
    /// Comment / review body (for `commented` and `reviewed`).
    pub body: Option<String>,
    /// Uppercase review verdict for `reviewed`
    /// (`APPROVED` / `CHANGES_REQUESTED` / `COMMENTED` / `DISMISSED`).
    pub state: Option<String>,
    /// Label name (for `labeled` / `unlabeled`).
    pub label: Option<String>,
    /// Label hex color without `#` (for `labeled` / `unlabeled`).
    pub label_color: Option<String>,
    /// Short commit hash (for `committed` / `merged` / `referenced`).
    pub commit_sha: Option<String>,
    /// First line of a commit message (for `committed`).
    pub commit_message: Option<String>,
    /// The action's target: assignee/reviewer login, rename destination, milestone
    /// title, or a cross-referenced issue/PR title.
    pub subject: Option<String>,
    /// A cross-referenced issue/PR number (for `cross-referenced`).
    pub ref_number: Option<i64>,
    /// Whether a `committed` event's commit signature is verified.
    pub verified: Option<bool>,
}

/// Fetch full detail for one PR.
pub async fn pr_view(worktree_path: &str, number: &str) -> Result<PrDetail, AppError> {
    let number = validate_number(number)?;
    let v = gh_json(
        Some(worktree_path),
        &["pr", "view", &number, "--json", PR_DETAIL_FIELDS],
    )
    .await?;
    Ok(PrDetail {
        number: v.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
        title: str_field(&v, "title"),
        body: str_field(&v, "body"),
        state: str_field(&v, "state"),
        is_draft: v.get("isDraft").and_then(|b| b.as_bool()).unwrap_or(false),
        url: str_field(&v, "url"),
        author: login_field(&v, "author"),
        base_ref_name: opt_str_field(&v, "baseRefName"),
        head_ref_name: opt_str_field(&v, "headRefName"),
        additions: v.get("additions").and_then(|n| n.as_u64()).unwrap_or(0),
        deletions: v.get("deletions").and_then(|n| n.as_u64()).unwrap_or(0),
        changed_files: v.get("changedFiles").and_then(|n| n.as_u64()).unwrap_or(0),
        mergeable: opt_str_field(&v, "mergeable"),
        merge_state_status: opt_str_field(&v, "mergeStateStatus"),
        review_decision: opt_str_field(&v, "reviewDecision"),
        created_at: opt_str_field(&v, "createdAt"),
        updated_at: opt_str_field(&v, "updatedAt"),
        labels: name_list(&v, "labels"),
        files: files_from_json(v.get("files")),
        checks: check_items_from_rollup(v.get("statusCheckRollup")),
        checks_summary: check_summary_from_rollup(v.get("statusCheckRollup")),
        reviewers: reviewers_from_json(v.get("reviewRequests")),
        reviews: reviews_from_json(v.get("reviews")),
        comments: comments_from_json(v.get("comments")),
        commits: commits_from_json(v.get("commits")),
    })
}

/// Requested reviewers: user `login` or team `name`/`slug`.
fn reviewers_from_json(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    e.get("login")
                        .or_else(|| e.get("name"))
                        .or_else(|| e.get("slug"))
                        .and_then(|s| s.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn reviews_from_json(v: Option<&serde_json::Value>) -> Vec<PrReview> {
    v.and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .map(|r| PrReview {
                    author: login_field(r, "author"),
                    state: str_field(r, "state"),
                    body: str_field(r, "body"),
                    submitted_at: opt_str_field(r, "submittedAt"),
                })
                // Drop empty PENDING/COMMENTED reviews with no body and no verdict.
                .filter(|r| !r.body.trim().is_empty() || r.state != "COMMENTED")
                .collect()
        })
        .unwrap_or_default()
}

fn comments_from_json(v: Option<&serde_json::Value>) -> Vec<PrComment> {
    v.and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .map(|c| PrComment {
                    author: login_field(c, "author"),
                    body: str_field(c, "body"),
                    created_at: opt_str_field(c, "createdAt"),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn commits_from_json(v: Option<&serde_json::Value>) -> Vec<PrCommit> {
    v.and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .map(|c| PrCommit {
                    oid: str_field(c, "oid"),
                    message: c
                        .get("messageHeadline")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string(),
                    // `authors` is an array of {login,name}; take the first.
                    author: c
                        .get("authors")
                        .and_then(|a| a.as_array())
                        .and_then(|a| a.first())
                        .and_then(|a| {
                            a.get("login")
                                .or_else(|| a.get("name"))
                                .and_then(|s| s.as_str())
                        })
                        .map(str::to_string),
                    committed_at: opt_str_field(c, "committedDate"),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn files_from_json(files: Option<&serde_json::Value>) -> Vec<PrFile> {
    files
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|f| PrFile {
                    path: str_field(f, "path"),
                    additions: f.get("additions").and_then(|n| n.as_u64()).unwrap_or(0),
                    deletions: f.get("deletions").and_then(|n| n.as_u64()).unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The unified diff of a PR (`gh pr diff <n>`).
pub async fn pr_diff(worktree_path: &str, number: &str) -> Result<String, AppError> {
    let number = validate_number(number)?;
    gh(Some(worktree_path), &["pr", "diff", &number]).await
}

/// Options for creating a PR.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCreateOptions {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub base: Option<String>,
    #[serde(default)]
    pub draft: bool,
}

/// Create a PR from the worktree's current branch. Returns the new PR's URL.
pub async fn pr_create(worktree_path: &str, opts: PrCreateOptions) -> Result<String, AppError> {
    let title = opts.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("a PR title is required".to_string()));
    }
    let body = opts.body.clone();
    let mut args: Vec<String> = vec![
        "pr".into(),
        "create".into(),
        "--title".into(),
        title.into(),
        "--body".into(),
        body,
    ];
    if let Some(base) = opts
        .base
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--base".into());
        args.push(base.into());
    }
    if opts.draft {
        args.push("--draft".into());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    gh(Some(worktree_path), &arg_refs).await
}

/// Submit a review verb (`approve|request-changes|comment`) on a PR.
pub async fn pr_review(
    worktree_path: &str,
    number: &str,
    verb: &str,
    body: Option<&str>,
) -> Result<(), AppError> {
    let number = validate_number(number)?;
    let flag = match verb {
        "approve" => "--approve",
        "request-changes" => "--request-changes",
        "comment" => "--comment",
        other => return Err(AppError::Invalid(format!("unknown review verb: {other}"))),
    };
    let mut args = vec!["pr", "review", &number, flag];
    let body = body.map(str::trim).filter(|s| !s.is_empty());
    if let Some(b) = body {
        args.push("--body");
        args.push(b);
    } else if flag == "--comment" {
        return Err(AppError::Invalid(
            "a comment review needs a body".to_string(),
        ));
    }
    gh(Some(worktree_path), &args).await.map(|_| ())
}

/// Post a conversation comment on a PR (`gh pr comment <n> --body`). This is a plain
/// issue comment, not a review verdict (see [`pr_review`]).
pub async fn pr_comment(worktree_path: &str, number: &str, body: &str) -> Result<(), AppError> {
    let number = validate_number(number)?;
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::Invalid("a comment body is required".to_string()));
    }
    gh(
        Some(worktree_path),
        &["pr", "comment", &number, "--body", body],
    )
    .await
    .map(|_| ())
}

/// Close a PR without merging (`gh pr close <n>`).
pub async fn pr_close(worktree_path: &str, number: &str) -> Result<(), AppError> {
    let number = validate_number(number)?;
    gh(Some(worktree_path), &["pr", "close", &number])
        .await
        .map(|_| ())
}

/// Reopen a closed PR (`gh pr reopen <n>`).
pub async fn pr_reopen(worktree_path: &str, number: &str) -> Result<(), AppError> {
    let number = validate_number(number)?;
    gh(Some(worktree_path), &["pr", "reopen", &number])
        .await
        .map(|_| ())
}

/// Merge a PR. `method` is `merge|squash|rebase`.
pub async fn pr_merge(
    worktree_path: &str,
    number: &str,
    method: &str,
    delete_branch: bool,
) -> Result<(), AppError> {
    let number = validate_number(number)?;
    let flag = match method {
        "merge" => "--merge",
        "squash" => "--squash",
        "rebase" => "--rebase",
        other => return Err(AppError::Invalid(format!("unknown merge method: {other}"))),
    };
    let mut args = vec!["pr", "merge", &number, flag];
    if delete_branch {
        args.push("--delete-branch");
    }
    gh(Some(worktree_path), &args).await.map(|_| ())
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/// One row in the issue list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueListItem {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
    pub author: Option<String>,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub updated_at: Option<String>,
    pub comments: u64,
}

/// List issues for a repo.
pub async fn issue_list(
    worktree_path: &str,
    state: &str,
    search: Option<&str>,
    limit: u32,
) -> Result<Vec<IssueListItem>, AppError> {
    let limit = limit.clamp(1, 100).to_string();
    let state = normalize_state(state);
    let mut args = vec![
        "issue",
        "list",
        "--json",
        ISSUE_LIST_FIELDS,
        "--state",
        state,
        "--limit",
        &limit,
    ];
    if let Some(s) = search.map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--search");
        args.push(s);
    }
    let v = gh_json(Some(worktree_path), &args).await?;
    Ok(v.as_array()
        .map(|arr| {
            arr.iter()
                .map(|i| IssueListItem {
                    number: i.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
                    title: str_field(i, "title"),
                    state: str_field(i, "state"),
                    url: str_field(i, "url"),
                    author: login_field(i, "author"),
                    labels: name_list(i, "labels"),
                    assignees: login_list(i, "assignees"),
                    updated_at: opt_str_field(i, "updatedAt"),
                    comments: comment_count(i.get("comments")),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// Full detail for one issue (body + metadata). Comments are fetched via `gh api`
/// on demand by the frontend later; the MVP shows the body + metadata.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub url: String,
    pub author: Option<String>,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// Conversation comments on the issue.
    pub comments: Vec<PrComment>,
}

/// Fetch full detail for one issue.
pub async fn issue_view(worktree_path: &str, number: &str) -> Result<IssueDetail, AppError> {
    let number = validate_number(number)?;
    let v = gh_json(
        Some(worktree_path),
        &["issue", "view", &number, "--json", ISSUE_DETAIL_FIELDS],
    )
    .await?;
    Ok(IssueDetail {
        number: v.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
        title: str_field(&v, "title"),
        body: str_field(&v, "body"),
        state: str_field(&v, "state"),
        url: str_field(&v, "url"),
        author: login_field(&v, "author"),
        labels: name_list(&v, "labels"),
        assignees: login_list(&v, "assignees"),
        created_at: opt_str_field(&v, "createdAt"),
        updated_at: opt_str_field(&v, "updatedAt"),
        comments: comments_from_json(v.get("comments")),
    })
}

/// Fetch the **timeline** of a PR or issue — GitHub's Timeline Events API. Since a
/// PR *is* an issue in the REST API, one endpoint serves both:
/// `GET /repos/{owner}/{repo}/issues/{n}/timeline`. `gh api` fills the
/// `{owner}`/`{repo}` placeholders from the repo at `worktree_path`, and
/// `--paginate` merges every page into a single JSON array. Events are returned
/// oldest-first (already the API's order) and normalized into `TimelineEvent`s;
/// unrecognized event kinds are dropped rather than shown as noise.
pub async fn pr_timeline(
    worktree_path: &str,
    number: &str,
) -> Result<Vec<TimelineEvent>, AppError> {
    let number = validate_number(number)?;
    let path = format!("repos/{{owner}}/{{repo}}/issues/{number}/timeline");
    let v = gh_json(
        Some(worktree_path),
        &["api", &path, "--paginate", "--cache", "20s"],
    )
    .await?;
    Ok(timeline_events_from_json(&v))
}

/// Normalize the Timeline Events API array into rendered `TimelineEvent`s,
/// skipping kinds we don't surface.
fn timeline_events_from_json(v: &serde_json::Value) -> Vec<TimelineEvent> {
    v.as_array()
        .map(|arr| arr.iter().filter_map(map_timeline_event).collect())
        .unwrap_or_default()
}

/// Map one raw timeline event object to a `TimelineEvent`, or `None` to drop it.
fn map_timeline_event(e: &serde_json::Value) -> Option<TimelineEvent> {
    let event = str_field(e, "event");
    // The actor is `actor.login` for most events, `user.login` for comments/reviews,
    // and the git author name for commits.
    let actor = login_field(e, "actor")
        .or_else(|| login_field(e, "user"))
        .or_else(|| {
            e.get("author")
                .and_then(|a| a.get("name"))
                .and_then(|s| s.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        });
    // Timestamp: `created_at` for most, `submitted_at` for reviews, the git author
    // date for commits.
    let created_at = opt_str_field(e, "created_at")
        .or_else(|| opt_str_field(e, "submitted_at"))
        .or_else(|| {
            e.get("author")
                .and_then(|a| a.get("date"))
                .and_then(|s| s.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        });

    let mut ev = TimelineEvent {
        event: event.clone(),
        actor,
        created_at,
        body: None,
        state: None,
        label: None,
        label_color: None,
        commit_sha: None,
        commit_message: None,
        subject: None,
        ref_number: None,
        verified: None,
    };

    match event.as_str() {
        "commented" => {
            ev.body = opt_str_field(e, "body");
        }
        "reviewed" => {
            // Drop empty "commented" reviews (a review with no verdict and no text is
            // pure noise). Verdicts arrive lowercase here; uppercase for parity with
            // `pr view --json reviews` and the `github.review.*` labels.
            let state = str_field(e, "state").to_uppercase();
            let body = opt_str_field(e, "body");
            if state == "COMMENTED" && body.as_deref().map(str::trim).unwrap_or("").is_empty() {
                return None;
            }
            ev.state = Some(state);
            ev.body = body;
        }
        "committed" => {
            ev.commit_sha = opt_str_field(e, "sha").map(|s| s.chars().take(7).collect());
            ev.commit_message = e
                .get("message")
                .and_then(|s| s.as_str())
                .map(|m| m.lines().next().unwrap_or("").to_string());
            ev.verified = e
                .get("verification")
                .and_then(|v| v.get("verified"))
                .and_then(|b| b.as_bool());
        }
        "labeled" | "unlabeled" => {
            ev.label = e
                .get("label")
                .and_then(|l| l.get("name"))
                .and_then(|s| s.as_str())
                .map(str::to_string);
            ev.label_color = e
                .get("label")
                .and_then(|l| l.get("color"))
                .and_then(|s| s.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
        }
        "assigned" | "unassigned" => {
            ev.subject = login_field(e, "assignee");
        }
        "review_requested" | "review_request_removed" => {
            ev.subject = login_field(e, "requested_reviewer").or_else(|| {
                e.get("requested_team")
                    .and_then(|t| t.get("name"))
                    .and_then(|s| s.as_str())
                    .map(str::to_string)
            });
        }
        "renamed" => {
            ev.subject = e
                .get("rename")
                .and_then(|r| r.get("to"))
                .and_then(|s| s.as_str())
                .map(str::to_string);
        }
        "milestoned" | "demilestoned" => {
            ev.subject = e
                .get("milestone")
                .and_then(|m| m.get("title"))
                .and_then(|s| s.as_str())
                .map(str::to_string);
        }
        "cross-referenced" => {
            let issue = e.get("source").and_then(|s| s.get("issue"));
            ev.subject = issue
                .and_then(|i| i.get("title"))
                .and_then(|s| s.as_str())
                .map(str::to_string);
            ev.ref_number = issue.and_then(|i| i.get("number")).and_then(|n| n.as_i64());
        }
        "merged" | "referenced" => {
            ev.commit_sha = opt_str_field(e, "commit_id").map(|s| s.chars().take(7).collect());
        }
        // Rendered with just actor + verb + time.
        "closed"
        | "reopened"
        | "head_ref_force_pushed"
        | "head_ref_deleted"
        | "head_ref_restored"
        | "ready_for_review"
        | "convert_to_draft"
        | "locked"
        | "unlocked"
        | "pinned"
        | "unpinned" => {}
        // Everything else (subscribed, mentioned, …) is noise — drop it.
        _ => return None,
    }
    Some(ev)
}

/// Close an issue (`gh issue close <n>`).
pub async fn issue_close(worktree_path: &str, number: &str) -> Result<(), AppError> {
    let number = validate_number(number)?;
    gh(Some(worktree_path), &["issue", "close", &number])
        .await
        .map(|_| ())
}

/// Reopen a closed issue (`gh issue reopen <n>`).
pub async fn issue_reopen(worktree_path: &str, number: &str) -> Result<(), AppError> {
    let number = validate_number(number)?;
    gh(Some(worktree_path), &["issue", "reopen", &number])
        .await
        .map(|_| ())
}

/// Post a comment on an issue (`gh issue comment <n> --body`).
pub async fn issue_comment(worktree_path: &str, number: &str, body: &str) -> Result<(), AppError> {
    let number = validate_number(number)?;
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::Invalid("a comment body is required".to_string()));
    }
    gh(
        Some(worktree_path),
        &["issue", "comment", &number, "--body", body],
    )
    .await
    .map(|_| ())
}

/// Create + link a branch for an issue (`gh issue develop <n> --name <branch>`).
/// The worktree is materialized by the caller (`commands::github_issue_develop`).
pub async fn issue_develop(
    worktree_path: &str,
    number: &str,
    branch: &str,
) -> Result<(), AppError> {
    let number = validate_number(number)?;
    gh(
        Some(worktree_path),
        &["issue", "develop", &number, "--name", branch],
    )
    .await
    .map(|_| ())
}

/// Create an issue. Returns the new issue's URL.
pub async fn issue_create(
    worktree_path: &str,
    title: &str,
    body: &str,
) -> Result<String, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("an issue title is required".to_string()));
    }
    gh(
        Some(worktree_path),
        &["issue", "create", "--title", title, "--body", body],
    )
    .await
}

// ---------------------------------------------------------------------------
// Actions / workflow runs
// ---------------------------------------------------------------------------

/// One workflow run row.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunListItem {
    pub database_id: u64,
    pub name: String,
    pub display_title: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub head_branch: Option<String>,
    pub workflow_name: Option<String>,
    pub event: Option<String>,
    pub created_at: Option<String>,
    pub url: String,
}

/// List recent workflow runs (optionally filtered to a branch).
pub async fn run_list(
    worktree_path: &str,
    branch: Option<&str>,
    limit: u32,
) -> Result<Vec<RunListItem>, AppError> {
    let limit = limit.clamp(1, 100).to_string();
    let mut args = vec!["run", "list", "--json", RUN_LIST_FIELDS, "--limit", &limit];
    if let Some(b) = branch.map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--branch");
        args.push(b);
    }
    let v = gh_json(Some(worktree_path), &args).await?;
    Ok(v.as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| RunListItem {
                    database_id: r.get("databaseId").and_then(|n| n.as_u64()).unwrap_or(0),
                    name: str_field(r, "name"),
                    display_title: str_field(r, "displayTitle"),
                    status: str_field(r, "status"),
                    conclusion: opt_str_field(r, "conclusion"),
                    head_branch: opt_str_field(r, "headBranch"),
                    workflow_name: opt_str_field(r, "workflowName"),
                    event: opt_str_field(r, "event"),
                    created_at: opt_str_field(r, "createdAt"),
                    url: str_field(r, "url"),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// The plain-text log of a workflow run (`gh run view <id> --log`). Large; the
/// frontend renders it terminal-style. Failed-only via [`run_log`] with `failed`.
pub async fn run_log(worktree_path: &str, run_id: &str, failed: bool) -> Result<String, AppError> {
    let run_id = validate_number(run_id)?;
    let mut args = vec!["run", "view", &run_id, "--log"];
    if failed {
        args.push("--log-failed");
    }
    gh(Some(worktree_path), &args).await
}

/// Re-run a workflow run (`--failed` re-runs only failed jobs).
pub async fn run_rerun(worktree_path: &str, run_id: &str, failed: bool) -> Result<(), AppError> {
    let run_id = validate_number(run_id)?;
    let mut args = vec!["run", "rerun", &run_id];
    if failed {
        args.push("--failed");
    }
    gh(Some(worktree_path), &args).await.map(|_| ())
}

/// Cancel an in-progress workflow run.
pub async fn run_cancel(worktree_path: &str, run_id: &str) -> Result<(), AppError> {
    let run_id = validate_number(run_id)?;
    gh(Some(worktree_path), &["run", "cancel", &run_id])
        .await
        .map(|_| ())
}

// ---------------------------------------------------------------------------
// Rate limit + notifications (via `gh api`)
// ---------------------------------------------------------------------------

/// The core REST rate-limit window, for the status-bar quota gauge.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimit {
    pub limit: u64,
    pub remaining: u64,
    pub used: u64,
    /// Reset time (epoch seconds).
    pub reset: i64,
}

/// Read the authenticated core REST rate limit (`gh api rate_limit`). This
/// endpoint doesn't count against the limit.
pub async fn rate_limit() -> Result<RateLimit, AppError> {
    let v = gh_json(None, &["api", "rate_limit"]).await?;
    let core = v
        .get("resources")
        .and_then(|r| r.get("core"))
        .ok_or_else(|| AppError::Github("rate_limit response missing core".to_string()))?;
    Ok(RateLimit {
        limit: core.get("limit").and_then(|n| n.as_u64()).unwrap_or(0),
        remaining: core.get("remaining").and_then(|n| n.as_u64()).unwrap_or(0),
        used: core.get("used").and_then(|n| n.as_u64()).unwrap_or(0),
        reset: core.get("reset").and_then(|n| n.as_i64()).unwrap_or(0),
    })
}

/// The count of unread notifications (`gh api notifications`), for the status-bar
/// badge. Best-effort: a short-circuited `--jq length` keeps the payload tiny.
pub async fn notifications_count() -> Result<u64, AppError> {
    let out = gh(
        None,
        &["api", "notifications", "--jq", "length", "--cache", "60s"],
    )
    .await?;
    Ok(out.trim().parse().unwrap_or(0))
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

/// Clone a GitHub repo (`gh repo clone <repo> <dest>`) so it can be added as a
/// project. `repo` may be `owner/name` or a full URL. Returns the destination path.
pub async fn clone(repo: &str, dest: &str) -> Result<String, AppError> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err(AppError::Invalid("a repo is required".to_string()));
    }
    gh(None, &["repo", "clone", repo, dest]).await?;
    Ok(dest.to_string())
}

// ---------------------------------------------------------------------------
// small JSON helpers
// ---------------------------------------------------------------------------

fn str_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

fn opt_str_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// The `login` of a nested `{ "author": { "login": … } }` object.
fn login_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|o| o.get("login"))
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// The `name`s of a `[{ "name": … }]` array (labels).
fn name_list(v: &serde_json::Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.get("name").and_then(|n| n.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// The `login`s of a `[{ "login": … }]` array (assignees).
fn login_list(v: &serde_json::Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.get("login").and_then(|n| n.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// `gh issue list` returns `comments` as an array; count it.
fn comment_count(v: Option<&serde_json::Value>) -> u64 {
    v.and_then(|c| c.as_array())
        .map(|a| a.len() as u64)
        .unwrap_or(0)
}

/// Normalize a UI state filter to a `gh` `--state` value.
fn normalize_state(state: &str) -> &'static str {
    match state.trim().to_ascii_lowercase().as_str() {
        "closed" => "closed",
        "merged" => "merged",
        "all" => "all",
        _ => "open",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_number_accepts_digits_only() {
        assert_eq!(validate_number(" 42 ").unwrap(), "42");
        assert!(validate_number("").is_err());
        assert!(validate_number("12a").is_err());
        assert!(validate_number("-3").is_err());
        assert!(validate_number("1 2").is_err());
        assert!(validate_number("$(rm -rf)").is_err());
    }

    #[test]
    fn parse_auth_status_current_gh_shape() {
        let out = "github.com\n  \u{2713} Logged in to github.com account luisgamas (keyring)\n  \
                   - Active account: true\n  - Git operations protocol: https\n  \
                   - Token: gho_************************************\n  \
                   - Token scopes: 'gist', 'read:org', 'repo', 'workflow'\n";
        let parsed = parse_auth_status(out).unwrap();
        assert_eq!(parsed.host, "github.com");
        assert_eq!(parsed.login, "luisgamas");
        assert_eq!(parsed.scopes, vec!["gist", "read:org", "repo", "workflow"]);
    }

    #[test]
    fn parse_auth_status_older_as_shape() {
        let out = "  \u{2713} Logged in to github.com as octocat (oauth_token)\n  \
                   \u{2713} Token scopes: repo, workflow\n";
        let parsed = parse_auth_status(out).unwrap();
        assert_eq!(parsed.host, "github.com");
        assert_eq!(parsed.login, "octocat");
        assert_eq!(parsed.scopes, vec!["repo", "workflow"]);
    }

    #[test]
    fn parse_auth_status_logged_out_is_none() {
        let out = "You are not logged into any GitHub hosts. Run gh auth login to authenticate.\n";
        assert!(parse_auth_status(out).is_none());
    }

    #[test]
    fn parse_repo_name_handles_forms() {
        assert_eq!(
            parse_repo_name("git@github.com:luisgamas/uxnan.git").unwrap(),
            "uxnan"
        );
        assert_eq!(
            parse_repo_name("https://github.com/luisgamas/uxnan.git").unwrap(),
            "uxnan"
        );
        assert_eq!(
            parse_repo_name("https://github.com/luisgamas/uxnan").unwrap(),
            "uxnan"
        );
        assert_eq!(parse_repo_name(""), None);
    }

    #[test]
    fn classify_check_buckets() {
        let pass = serde_json::json!({"status":"COMPLETED","conclusion":"SUCCESS"});
        let fail = serde_json::json!({"status":"COMPLETED","conclusion":"FAILURE"});
        let pending = serde_json::json!({"status":"IN_PROGRESS"});
        let skip = serde_json::json!({"status":"COMPLETED","conclusion":"SKIPPED"});
        let ctx_ok = serde_json::json!({"state":"SUCCESS","context":"ci"});
        let ctx_pending = serde_json::json!({"state":"PENDING","context":"ci"});
        assert_eq!(classify_check(&pass), "pass");
        assert_eq!(classify_check(&fail), "fail");
        assert_eq!(classify_check(&pending), "pending");
        assert_eq!(classify_check(&skip), "skip");
        assert_eq!(classify_check(&ctx_ok), "pass");
        assert_eq!(classify_check(&ctx_pending), "pending");
    }

    #[test]
    fn check_summary_rolls_up() {
        let rollup = serde_json::json!([
            {"status":"COMPLETED","conclusion":"SUCCESS"},
            {"status":"COMPLETED","conclusion":"FAILURE"},
            {"status":"IN_PROGRESS"},
        ]);
        let s = check_summary_from_rollup(Some(&rollup));
        assert_eq!(s.total, 3);
        assert_eq!(s.passed, 1);
        assert_eq!(s.failed, 1);
        assert_eq!(s.pending, 1);
        assert_eq!(s.state, "failure");

        let all_good = serde_json::json!([{"status":"COMPLETED","conclusion":"SUCCESS"}]);
        assert_eq!(check_summary_from_rollup(Some(&all_good)).state, "success");
        assert_eq!(check_summary_from_rollup(None).state, "none");
    }

    #[test]
    fn normalize_state_maps() {
        assert_eq!(normalize_state("OPEN"), "open");
        assert_eq!(normalize_state("closed"), "closed");
        assert_eq!(normalize_state("merged"), "merged");
        assert_eq!(normalize_state("all"), "all");
        assert_eq!(normalize_state("garbage"), "open");
    }

    #[test]
    fn pr_summary_from_json_maps_fields() {
        let v = serde_json::json!({
            "number": 7, "title": "Fix", "state": "OPEN", "isDraft": false,
            "url": "https://x/7", "reviewDecision": "APPROVED", "mergeable": "MERGEABLE",
            "statusCheckRollup": [{"status":"COMPLETED","conclusion":"SUCCESS"}]
        });
        let s = pr_summary_from_json(&v);
        assert_eq!(s.number, 7);
        assert_eq!(s.title, "Fix");
        assert_eq!(s.review_decision.as_deref(), Some("APPROVED"));
        assert_eq!(s.checks.state, "success");
    }

    #[test]
    fn reviewers_from_json_reads_login_name_or_slug() {
        let v = serde_json::json!([
            { "login": "alice" },
            { "name": "Bob" },
            { "slug": "team/reviewers" },
            { "other": "ignored" },
        ]);
        let r = reviewers_from_json(Some(&v));
        assert_eq!(r, vec!["alice", "Bob", "team/reviewers"]);
        assert!(reviewers_from_json(None).is_empty());
    }

    #[test]
    fn reviews_from_json_drops_empty_commented() {
        let v = serde_json::json!([
            { "author": {"login": "alice"}, "state": "APPROVED", "body": "", "submittedAt": "2026-01-01T00:00:00Z" },
            { "author": {"login": "bob"}, "state": "COMMENTED", "body": "  ", "submittedAt": "2026-01-02T00:00:00Z" },
            { "author": {"login": "carol"}, "state": "COMMENTED", "body": "please fix", "submittedAt": "2026-01-03T00:00:00Z" },
        ]);
        let r = reviews_from_json(Some(&v));
        // The empty COMMENTED review is dropped; APPROVED (no body) and COMMENTED-with-body stay.
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].author.as_deref(), Some("alice"));
        assert_eq!(r[0].state, "APPROVED");
        assert_eq!(r[1].author.as_deref(), Some("carol"));
        assert_eq!(r[1].body, "please fix");
    }

    #[test]
    fn comments_from_json_maps_fields() {
        let v = serde_json::json!([
            { "author": {"login": "alice"}, "body": "hi", "createdAt": "2026-01-01T00:00:00Z" },
        ]);
        let c = comments_from_json(Some(&v));
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].author.as_deref(), Some("alice"));
        assert_eq!(c[0].body, "hi");
        assert_eq!(c[0].created_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    }

    #[test]
    fn timeline_maps_kinds_and_drops_noise() {
        let v = serde_json::json!([
            { "event": "commented", "user": {"login": "alice"}, "body": "hi", "created_at": "2026-01-01T00:00:00Z" },
            { "event": "reviewed", "user": {"login": "bob"}, "state": "approved", "body": "", "submitted_at": "2026-01-02T00:00:00Z" },
            { "event": "reviewed", "user": {"login": "carol"}, "state": "commented", "body": "", "submitted_at": "2026-01-03T00:00:00Z" },
            { "event": "committed", "sha": "abc1234567", "message": "feat: thing\n\nbody", "author": {"name": "Dev", "date": "2026-01-04T00:00:00Z"}, "verification": {"verified": true} },
            { "event": "labeled", "actor": {"login": "alice"}, "label": {"name": "bug", "color": "d73a4a"}, "created_at": "2026-01-05T00:00:00Z" },
            { "event": "cross-referenced", "actor": {"login": "eve"}, "created_at": "2026-01-06T00:00:00Z", "source": {"issue": {"number": 42, "title": "Related"}} },
            { "event": "subscribed", "actor": {"login": "noise"}, "created_at": "2026-01-07T00:00:00Z" },
        ]);
        let t = timeline_events_from_json(&v);
        // The empty COMMENTED review and the `subscribed` noise are dropped → 5 kept.
        assert_eq!(t.len(), 5);

        assert_eq!(t[0].event, "commented");
        assert_eq!(t[0].actor.as_deref(), Some("alice"));
        assert_eq!(t[0].body.as_deref(), Some("hi"));

        assert_eq!(t[1].event, "reviewed");
        assert_eq!(t[1].state.as_deref(), Some("APPROVED")); // uppercased

        assert_eq!(t[2].event, "committed");
        assert_eq!(t[2].actor.as_deref(), Some("Dev")); // git author name
        assert_eq!(t[2].commit_sha.as_deref(), Some("abc1234")); // 7-char short
        assert_eq!(t[2].commit_message.as_deref(), Some("feat: thing")); // first line
        assert_eq!(t[2].created_at.as_deref(), Some("2026-01-04T00:00:00Z"));
        assert_eq!(t[2].verified, Some(true)); // from verification.verified

        assert_eq!(t[3].event, "labeled");
        assert_eq!(t[3].label.as_deref(), Some("bug"));
        assert_eq!(t[3].label_color.as_deref(), Some("d73a4a"));

        assert_eq!(t[4].event, "cross-referenced");
        assert_eq!(t[4].subject.as_deref(), Some("Related"));
        assert_eq!(t[4].ref_number, Some(42));
    }

    #[test]
    fn commits_from_json_takes_first_author() {
        let v = serde_json::json!([
            {
                "oid": "abc123",
                "messageHeadline": "feat: add thing",
                "authors": [{ "login": "alice" }, { "login": "bob" }],
                "committedDate": "2026-01-01T00:00:00Z",
            },
        ]);
        let c = commits_from_json(Some(&v));
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].oid, "abc123");
        assert_eq!(c[0].message, "feat: add thing");
        assert_eq!(c[0].author.as_deref(), Some("alice"));
        assert_eq!(c[0].committed_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    }
}
