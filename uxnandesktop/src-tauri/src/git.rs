//! Git operations for repos and worktrees.
//!
//! **Dual engine** (spec `02c` §3.1): high-frequency status/diff (`status_files`,
//! `worktree_status`, `diff_file`, `diff_head`, `numstat`) run through `git2`
//! (libgit2, in `gitfast.rs`, off the async runtime via `spawn_blocking`) to
//! avoid a subprocess per 3 s poll, each with a **CLI fallback** here. Worktree
//! management, branch listing, staging, commit, push/pull and patch-apply stay
//! on the git **CLI** (via `tokio::process::Command`, `shell:false` — args are a
//! vector, never interpolated), which libgit2 supports only partially.

use std::path::Path;

use serde::Serialize;
use tokio::process::Command;

use crate::error::AppError;

/// A worktree as reported by `git worktree list --porcelain`. Includes worktrees
/// created by the ADE *and* any created externally (e.g. by a CLI agent).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    /// The repository's primary worktree (the original checkout).
    pub is_main: bool,
}

/// Outcome of [`remove_worktree`], so the frontend can tell the user what
/// happened to the branch. The worktree itself is always removed on success;
/// these flags only describe the *branch* cleanup (spec §2.3).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoveOutcome {
    /// The branch was deleted (either a safe `-d` delete of merged work, or a
    /// forced `-D` of a branch whose changes are already squash-merged).
    pub branch_deleted: bool,
    /// The branch was kept because its changes couldn't be confirmed as merged
    /// (so no work is lost); the user can delete it by hand later.
    pub branch_preserved: bool,
    /// The deletion relied on squash-merge (patch-equivalence) detection — the
    /// branch's commits aren't ancestors of the base, but its net diff already
    /// is. Surfaced so the toast can say the branch was cleaned up, not just
    /// "removed".
    pub squash_merged: bool,
}

/// Working-tree status summary for a worktree card badge.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// Number of changed entries (modified/added/deleted/untracked).
    pub dirty: u32,
    /// Commits ahead of the upstream (0 when there is none).
    pub ahead: u32,
    /// Commits behind the upstream (0 when there is none).
    pub behind: u32,
}

/// One changed file in a worktree, as reported by `git status --porcelain=v1`.
/// `index`/`worktree` are the two single-character XY status codes (` ` = clean,
/// `M`/`A`/`D`/`R`/`C`/`U` for tracked changes, `?` = untracked). The frontend
/// derives "staged", "modified" and "untracked" from these.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Index (staged) status code — the `X` of `XY`.
    pub index: String,
    /// Working-tree (unstaged) status code — the `Y` of `XY`.
    pub worktree: String,
}

/// One commit in the history log, for the right panel's "History" tab. `parents`
/// powers the branch graph (a commit with 2+ parents is a merge); `refs` carries
/// the ref decorations (e.g. `HEAD`, branch names, `tag: v1`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    /// Full 40-char commit hash.
    pub hash: String,
    /// Abbreviated hash (git's default short length).
    pub short_hash: String,
    /// Parent hashes (0 for a root commit, 2+ for a merge).
    pub parents: Vec<String>,
    /// First line of the message.
    pub subject: String,
    /// The rest of the message (after the first blank line); may be empty.
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    /// Author time, Unix seconds.
    pub timestamp: i64,
    /// Ref decorations pointing at this commit (`HEAD`, branches, `tag: …`).
    pub refs: Vec<String>,
}

/// Build the `git` invocation for `repo_path`. A normal path runs the native
/// `git -C <path> …`; a WSL UNC path (`\\wsl.localhost\<distro>\…`) is routed
/// through `wsl.exe -d <distro> git -C <linux-path> …` so the distro's own Linux
/// git runs against the repo (spec `02c` §3.2). Any further arg that is itself a
/// WSL UNC path (e.g. a worktree path) is translated to its Linux form;
/// everything else (subcommands, flags, relative file paths) passes through
/// untouched. Off Windows the WSL branch compiles out.
fn git_command(repo_path: &str, args: &[&str]) -> Command {
    #[cfg(windows)]
    {
        if let Some(w) = crate::wsl::parse(repo_path) {
            let mut cmd = Command::new("wsl.exe");
            cmd.arg("-d")
                .arg(&w.distro)
                .arg("git")
                .arg("-C")
                .arg(&w.linux);
            for a in args {
                match crate::wsl::parse(a) {
                    Some(p) => {
                        cmd.arg(p.linux);
                    }
                    None => {
                        cmd.arg(a);
                    }
                }
            }
            return cmd;
        }
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo_path).args(args);
    cmd
}

/// Run `git` in `repo_path` and return stdout on success, mapping a non-zero
/// exit (with stderr) to [`AppError::Git`].
async fn git(repo_path: &str, args: &[&str]) -> Result<String, AppError> {
    let output = git_command(repo_path, args)
        .output()
        .await
        .map_err(|e| AppError::Git(e.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(stderr.trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Like [`git`] but tolerates exit code 1, which `git diff --no-index` uses to
/// signal "files differ" (not an error). Any other non-zero is still an error.
async fn git_diff_tolerant(repo_path: &str, args: &[&str]) -> Result<String, AppError> {
    let output = git_command(repo_path, args)
        .output()
        .await
        .map_err(|e| AppError::Git(e.to_string()))?;
    match output.status.code() {
        Some(0) | Some(1) => Ok(String::from_utf8_lossy(&output.stdout).to_string()),
        _ => Err(AppError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        )),
    }
}

/// Whether `path` is inside a git work tree.
pub async fn is_git_repo(path: &str) -> bool {
    matches!(
        git(path, &["rev-parse", "--is-inside-work-tree"]).await,
        Ok(out) if out.trim() == "true"
    )
}

/// Human-friendly name for a repo path (its final path component).
pub fn repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Where a new worktree for `branch` is created: a sibling of the repo named
/// `<repo>--<branch>` (branch separators flattened so it's a valid folder).
///
/// The path is returned with forward slashes so it matches what `git worktree
/// list` reports (git normalizes to `/` even on Windows). Keeping one canonical
/// form means the frontend's per-worktree workspace keys line up — otherwise a
/// freshly-created worktree's backslash path wouldn't match its list entry, and
/// e.g. an auto-launched agent would open in an invisible workspace.
pub fn worktree_path_for(repo_path: &str, branch: &str) -> String {
    let repo = Path::new(repo_path);
    let parent = repo.parent().unwrap_or(repo);
    let name = repo_name(repo_path);
    let safe_branch = branch.replace(['/', '\\'], "-");
    parent
        .join(format!("{name}--{safe_branch}"))
        .to_string_lossy()
        .replace('\\', "/")
}

/// Create a worktree on a new branch
/// (`git worktree add --no-track -b <branch> <path> [<base>]`). `--no-track`
/// avoids inheriting the base's upstream so the new branch is not reported as
/// "behind" before its first push (spec §2.1). When `base` is `None` the new
/// branch starts from the repo's current `HEAD`.
pub async fn add_worktree(
    repo_path: &str,
    branch: &str,
    worktree_path: &str,
    base: Option<&str>,
) -> Result<(), AppError> {
    let mut args = vec!["worktree", "add", "--no-track", "-b", branch, worktree_path];
    if let Some(base) = base {
        args.push(base);
    }
    git(repo_path, &args).await.map(|_| ())
}

/// List the repo's local branch names. Used to populate the base-branch picker
/// when creating a worktree.
pub async fn list_branches(repo_path: &str) -> Result<Vec<String>, AppError> {
    let out = git(
        repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )
    .await?;
    Ok(parse_branch_lines(&out))
}

/// Parse one-ref-per-line output (`for-each-ref --format=%(refname:short)`) into
/// a clean, de-blanked list.
fn parse_branch_lines(input: &str) -> Vec<String> {
    input
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Resolve the most appropriate base ref for a new branch, probing in priority
/// order (spec §2.1): the remote HEAD's target (e.g. `origin/main`), then a
/// local `main`, then `master`, falling back to `HEAD`. Returns the short ref.
pub async fn default_base(repo_path: &str) -> String {
    if let Ok(out) = git(
        repo_path,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .await
    {
        let r = out.trim();
        if !r.is_empty() {
            return r.to_string();
        }
    }
    for candidate in ["main", "master"] {
        if git(repo_path, &["rev-parse", "--verify", "--quiet", candidate])
            .await
            .is_ok()
        {
            return candidate.to_string();
        }
    }
    "HEAD".to_string()
}

/// Whether a worktree has no uncommitted changes (its porcelain status is empty).
pub async fn is_worktree_clean(worktree_path: &str) -> Result<bool, AppError> {
    let out = git(worktree_path, &["status", "--porcelain"]).await?;
    Ok(out.trim().is_empty())
}

/// Summarize a worktree's working-tree status (changed entries + ahead/behind)
/// for its sidebar card. Fast path: `git2`; CLI fallback.
pub async fn worktree_status(worktree_path: &str) -> Result<WorktreeStatus, AppError> {
    // git2 (libgit2) can't see a WSL repo the way the in-distro git does, so for
    // a WSL path we skip the fast path and use the CLI (routed through wsl.exe).
    if !crate::wsl::is_wsl_path(worktree_path) {
        let p = worktree_path.to_string();
        if let Ok(Ok(v)) =
            tokio::task::spawn_blocking(move || crate::gitfast::worktree_status(&p)).await
        {
            return Ok(v);
        }
    }
    worktree_status_cli(worktree_path).await
}

/// CLI fallback for [`worktree_status`] (`status --porcelain=v1 --branch`).
async fn worktree_status_cli(worktree_path: &str) -> Result<WorktreeStatus, AppError> {
    let out = git(worktree_path, &["status", "--porcelain=v1", "--branch"]).await?;
    Ok(parse_status_porcelain(&out))
}

/// Parse `git status --porcelain=v1 --branch` output: the first `## ` line
/// carries the upstream ahead/behind (`[ahead N, behind M]`); every other
/// non-empty line is one changed entry.
pub fn parse_status_porcelain(input: &str) -> WorktreeStatus {
    let mut status = WorktreeStatus::default();
    for line in input.lines() {
        if let Some(branch) = line.strip_prefix("## ") {
            if let (Some(open), Some(close)) = (branch.find('['), branch.find(']')) {
                for part in branch[open + 1..close].split(',') {
                    let part = part.trim();
                    if let Some(n) = part.strip_prefix("ahead ") {
                        status.ahead = n.trim().parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix("behind ") {
                        status.behind = n.trim().parse().unwrap_or(0);
                    }
                }
            }
        } else if !line.trim().is_empty() {
            status.dirty += 1;
        }
    }
    status
}

/// Remove a worktree with safeguards (spec §2.3). With `force = false`, refuses
/// when the worktree has uncommitted changes. After removal it prunes the
/// administrative files and cleans up the branch: a *safe* delete (`git branch
/// -d`) for merged work, then — if that's refused — squash-merge detection
/// ([`is_squash_merged`]) which force-deletes (`git branch -D`) a branch whose
/// net diff is already in the base, otherwise the branch is **kept** so work is
/// never lost. The [`RemoveOutcome`] reports which path was taken so the UI can
/// tell the user.
pub async fn remove_worktree(
    repo_path: &str,
    worktree_path: &str,
    branch: Option<&str>,
    force: bool,
) -> Result<RemoveOutcome, AppError> {
    // Only block on uncommitted changes when the worktree is still a valid,
    // intact checkout. If `status` errors (a half-removed / broken worktree),
    // fall through so this call can finish cleaning it up.
    if !force {
        match is_worktree_clean(worktree_path).await {
            Ok(true) => {}
            Ok(false) => {
                return Err(AppError::Invalid(
                    "worktree has uncommitted changes; commit, stash, or force-remove".to_string(),
                ));
            }
            Err(_) => {}
        }
    }
    // Try a graceful remove, then a forced one. Ignore their errors — git can
    // reject a broken/locked worktree ("not a working tree"), but the prune +
    // directory cleanup below still tidies up, so removal is best-effort and
    // idempotent rather than fatal.
    if git(repo_path, &["worktree", "remove", worktree_path])
        .await
        .is_err()
    {
        let _ = git(repo_path, &["worktree", "remove", "--force", worktree_path]).await;
    }
    // Drop stale admin entries, then delete any directory git left behind (on
    // Windows a process that still had its CWD inside can block the delete; the
    // frontend kills the worktree's terminals first, and we retry briefly).
    let _ = git(repo_path, &["worktree", "prune"]).await;
    remove_dir_with_retry(worktree_path).await;

    let mut outcome = RemoveOutcome::default();
    if let Some(branch) = branch {
        // Safe delete first: succeeds only when the branch's commits are an
        // ancestor of some ref (truly merged), so it can never lose work.
        if git(repo_path, &["branch", "-d", branch]).await.is_ok() {
            outcome.branch_deleted = true;
        } else {
            // `-d` was refused (unmerged commits). The work may still have landed
            // as a *squash* merge — a single commit on the base carrying the same
            // net diff. If we can confirm that patch-equivalence, force-delete is
            // safe; otherwise keep the branch.
            let base = default_base(repo_path).await;
            if base != branch && is_squash_merged(repo_path, branch, &base).await {
                if git(repo_path, &["branch", "-D", branch]).await.is_ok() {
                    outcome.branch_deleted = true;
                    outcome.squash_merged = true;
                } else {
                    outcome.branch_preserved = true;
                }
            } else {
                outcome.branch_preserved = true;
            }
        }
    }
    Ok(outcome)
}

/// Whether `branch`'s net changes are already present in `base` as a squash
/// merge (patch-equivalence), even though its commits aren't ancestors of `base`
/// (so `git branch -d` refuses it). We synthesize a dangling commit holding the
/// branch's tree on top of `merge-base(base, branch)`, then ask `git cherry`
/// whether `base` already contains an equivalent patch — a `-`-prefixed line.
/// This is the canonical squash-merge check (used by e.g. git-delete-squashed).
/// Best-effort: any git error yields `false`, so the branch is kept rather than
/// risk deleting unmerged work.
async fn is_squash_merged(repo_path: &str, branch: &str, base: &str) -> bool {
    let Ok(merge_base) = git(repo_path, &["merge-base", base, branch]).await else {
        return false;
    };
    let merge_base = merge_base.trim();
    if merge_base.is_empty() {
        return false;
    }
    let tree_ref = format!("{branch}^{{tree}}");
    let Ok(tree) = git(repo_path, &["rev-parse", &tree_ref]).await else {
        return false;
    };
    let tree = tree.trim();
    if tree.is_empty() {
        return false;
    }
    // A commit with the branch's full tree, parented on the merge base, so its
    // single patch equals the branch's whole contribution since it diverged.
    let Ok(dangling) = git(
        repo_path,
        &["commit-tree", tree, "-p", merge_base, "-m", "_"],
    )
    .await
    else {
        return false;
    };
    let dangling = dangling.trim();
    if dangling.is_empty() {
        return false;
    }
    // `git cherry <upstream> <head>` marks each commit `+` (not in upstream) or
    // `-` (an equivalent patch already in upstream). A `-` means squash-merged.
    match git(repo_path, &["cherry", base, dangling]).await {
        Ok(out) => out.lines().any(|l| l.trim_start().starts_with('-')),
        Err(_) => false,
    }
}

/// Delete `path` if it still exists, retrying a few times so a just-released
/// Windows directory handle has a moment to clear.
async fn remove_dir_with_retry(path: &str) {
    let p = Path::new(path);
    for _ in 0..4 {
        if !p.exists() {
            return;
        }
        if tokio::fs::remove_dir_all(p).await.is_ok() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
}

/// List all worktrees of a repo (ADE-created and external). A registered folder
/// that isn't a git repo has no worktrees, so we synthesize a single "main"
/// entry pointing at the folder itself — the project still works as a terminal /
/// file-tree workspace, only its git-only panels stay empty.
pub async fn list_worktrees(repo_path: &str) -> Result<Vec<WorktreeEntry>, AppError> {
    if !is_git_repo(repo_path).await {
        return Ok(vec![WorktreeEntry {
            path: repo_path.to_string(),
            branch: None,
            head: None,
            is_main: true,
        }]);
    }
    let out = git(repo_path, &["worktree", "list", "--porcelain"]).await?;
    let mut entries = parse_worktree_porcelain(&out);
    // When routed through WSL, git reports Linux paths (`/home/u/repo`); map them
    // back to the UNC form the app registered so per-worktree workspace keys line
    // up (the frontend matches worktrees to projects by path). Off Windows /
    // non-WSL repos this is a no-op.
    #[cfg(windows)]
    if let Some(w) = crate::wsl::parse(repo_path) {
        for entry in &mut entries {
            if entry.path.starts_with('/') {
                entry.path = crate::wsl::to_unc(&w.host, &w.distro, &entry.path);
            }
        }
    }
    Ok(entries)
}

/// Parse `git worktree list --porcelain` output. Blocks are separated by blank
/// lines; the first block is the primary worktree.
pub fn parse_worktree_porcelain(input: &str) -> Vec<WorktreeEntry> {
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut current: Option<WorktreeEntry> = None;

    for line in input.lines() {
        if line.trim().is_empty() {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(WorktreeEntry {
                path: path.to_string(),
                branch: None,
                head: None,
                is_main: false,
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(entry) = current.as_mut() {
                entry.head = Some(head.to_string());
            }
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(entry) = current.as_mut() {
                entry.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
            }
        }
        // Other markers ("bare", "detached", "locked", ...) are ignored.
    }
    if let Some(entry) = current.take() {
        entries.push(entry);
    }
    if let Some(first) = entries.first_mut() {
        first.is_main = true;
    }
    entries
}

// --- Status, diffs & staging (Phase 3) -------------------------------------

/// List a worktree's changed files. Fast path: `git2` (no subprocess); falls
/// back to the git CLI if `git2` can't handle the repo.
pub async fn status_files(worktree_path: &str) -> Result<Vec<FileChange>, AppError> {
    // WSL repos go straight to the CLI (routed through wsl.exe); see worktree_status.
    if !crate::wsl::is_wsl_path(worktree_path) {
        let p = worktree_path.to_string();
        if let Ok(Ok(v)) =
            tokio::task::spawn_blocking(move || crate::gitfast::status_files(&p)).await
        {
            return Ok(v);
        }
    }
    status_files_cli(worktree_path).await
}

/// CLI fallback for [`status_files`] (`git status --porcelain=v1 -z
/// --untracked-files=all`). NUL-terminated so paths with spaces/newlines are
/// safe; rename/copy entries carry the original path in a trailing NUL field.
async fn status_files_cli(worktree_path: &str) -> Result<Vec<FileChange>, AppError> {
    let out = git(
        worktree_path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .await?;
    Ok(parse_status_files(&out))
}

/// Parse the NUL-separated `status --porcelain=v1 -z` output into [`FileChange`]s.
pub fn parse_status_files(input: &str) -> Vec<FileChange> {
    let fields: Vec<&str> = input.split('\0').collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let entry = fields[i];
        // Each entry is "XY <path>"; trailing empty field after the last NUL.
        if entry.len() < 4 {
            i += 1;
            continue;
        }
        let index = entry[0..1].to_string();
        let worktree = entry[1..2].to_string();
        let path = entry[3..].to_string();
        // Rename/copy entries are followed by the original path in the next field.
        if index == "R" || index == "C" || worktree == "R" || worktree == "C" {
            i += 1;
        }
        out.push(FileChange {
            path,
            index,
            worktree,
        });
        i += 1;
    }
    out
}

/// Unified diff for one file. `staged` selects the index-vs-HEAD diff; otherwise
/// the worktree-vs-index diff. Fast path: `git2`; CLI fallback.
pub async fn diff_file(worktree_path: &str, file: &str, staged: bool) -> Result<String, AppError> {
    // WSL repos go straight to the CLI (routed through wsl.exe); see worktree_status.
    if !crate::wsl::is_wsl_path(worktree_path) {
        let (p, f) = (worktree_path.to_string(), file.to_string());
        if let Ok(Ok(v)) =
            tokio::task::spawn_blocking(move || crate::gitfast::diff_file(&p, &f, staged)).await
        {
            // git2 returns an empty diff for an untracked file unless asked; if it's
            // empty, fall through to the CLI which handles the untracked `--no-index`
            // whole-file case.
            if !v.trim().is_empty() {
                return Ok(v);
            }
        }
    }
    diff_file_cli(worktree_path, file, staged).await
}

/// CLI fallback for [`diff_file`], incl. the untracked whole-file "added" diff.
async fn diff_file_cli(worktree_path: &str, file: &str, staged: bool) -> Result<String, AppError> {
    if staged {
        return git(worktree_path, &["diff", "--staged", "--", file]).await;
    }
    let tracked = git(worktree_path, &["diff", "--", file]).await?;
    if !tracked.trim().is_empty() {
        return Ok(tracked);
    }
    // Untracked: show the whole file as added (`--no-index` exits 1 on diff).
    git_diff_tolerant(
        worktree_path,
        &["diff", "--no-index", "--", "/dev/null", file],
    )
    .await
}

/// Per-file added/deleted line counts vs `HEAD`, for the changed-files list. The
/// `path` is worktree-relative (forward-slash, matching `status_files`). Binary
/// files report 0/0. Untracked files have no `HEAD` baseline and are omitted (the
/// frontend marks them as wholly new on its own).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileNumstat {
    pub path: String,
    pub added: u32,
    pub deleted: u32,
}

/// Added/deleted line counts per changed file vs `HEAD`. Fast path: `git2`;
/// CLI fallback (`git diff --numstat HEAD`).
pub async fn numstat(worktree_path: &str) -> Result<Vec<FileNumstat>, AppError> {
    // WSL repos go straight to the CLI (routed through wsl.exe); see worktree_status.
    if !crate::wsl::is_wsl_path(worktree_path) {
        let p = worktree_path.to_string();
        if let Ok(Ok(v)) = tokio::task::spawn_blocking(move || crate::gitfast::numstat(&p)).await {
            return Ok(v);
        }
    }
    numstat_cli(worktree_path).await
}

/// CLI fallback for [`numstat`].
async fn numstat_cli(worktree_path: &str) -> Result<Vec<FileNumstat>, AppError> {
    let out = git(worktree_path, &["diff", "--numstat", "HEAD"]).await?;
    Ok(parse_numstat(&out))
}

/// Parse `git diff --numstat HEAD` output: `<added>\t<deleted>\t<path>` per line
/// (`-` counts for binary files become 0).
pub fn parse_numstat(input: &str) -> Vec<FileNumstat> {
    let mut out = Vec::new();
    for line in input.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        out.push(FileNumstat {
            added: a.trim().parse().unwrap_or(0),
            deleted: d.trim().parse().unwrap_or(0),
            path: path.to_string(),
        });
    }
    out
}

/// Working-tree-vs-`HEAD` diff for one file (`git diff HEAD -- <file>`), used by
/// the editor's change gutter: it shows every line that differs from the last
/// commit (staged *and* unstaged together), which is what an IDE gutter marks.
/// Returns an empty string for a clean or untracked file (untracked files have
/// no `HEAD` baseline — the frontend treats those as wholly added on its own).
pub async fn diff_head(worktree_path: &str, file: &str) -> Result<String, AppError> {
    // WSL repos go straight to the CLI (routed through wsl.exe); see worktree_status.
    if !crate::wsl::is_wsl_path(worktree_path) {
        let (p, f) = (worktree_path.to_string(), file.to_string());
        if let Ok(Ok(v)) =
            tokio::task::spawn_blocking(move || crate::gitfast::diff_head(&p, &f)).await
        {
            return Ok(v);
        }
    }
    git(worktree_path, &["diff", "HEAD", "--", file]).await
}

/// Stage a file (`git add`).
pub async fn stage_file(worktree_path: &str, file: &str) -> Result<(), AppError> {
    git(worktree_path, &["add", "--", file]).await.map(|_| ())
}

/// Unstage a file (`git restore --staged`).
pub async fn unstage_file(worktree_path: &str, file: &str) -> Result<(), AppError> {
    git(worktree_path, &["restore", "--staged", "--", file])
        .await
        .map(|_| ())
}

/// Stage every change (`git add -A`).
pub async fn stage_all(worktree_path: &str) -> Result<(), AppError> {
    git(worktree_path, &["add", "-A"]).await.map(|_| ())
}

/// Unstage everything (`git reset -q`).
pub async fn unstage_all(worktree_path: &str) -> Result<(), AppError> {
    git(worktree_path, &["reset", "-q"]).await.map(|_| ())
}

/// Discard a file's local changes. For a tracked file, restore it to `HEAD`
/// (both index and worktree); for an untracked file, delete it (`git clean`).
/// Destructive — the frontend confirms first.
pub async fn discard_file(
    worktree_path: &str,
    file: &str,
    untracked: bool,
) -> Result<(), AppError> {
    if untracked {
        git(worktree_path, &["clean", "-fd", "--", file])
            .await
            .map(|_| ())
    } else {
        git(
            worktree_path,
            &[
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                file,
            ],
        )
        .await
        .map(|_| ())
    }
}

/// Apply a unified-diff `patch` to the worktree, feeding it on stdin (so odd
/// paths/content are safe). `cached` targets the index (stage); `reverse`
/// reverses the patch. Powers hunk-level staging — the frontend sends a
/// single-hunk sub-patch built from the file's diff:
/// - stage hunk: `cached = true,  reverse = false`
/// - unstage hunk: `cached = true,  reverse = true`  (from the staged diff)
/// - discard hunk: `cached = false, reverse = true`  (destructive; confirmed)
pub async fn apply_patch(
    worktree_path: &str,
    patch: &str,
    cached: bool,
    reverse: bool,
) -> Result<(), AppError> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let mut args: Vec<&str> = vec!["apply", "--whitespace=nowarn"];
    if cached {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    // `git_command` adds `-C <worktree_path>` and routes a WSL repo through
    // wsl.exe; the patch (forward-slash relative paths) is fed on stdin and is
    // valid in either environment.
    let mut child = git_command(worktree_path, &args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Git(e.to_string()))?;
    // Write the patch, then drop stdin so git sees EOF.
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Git("failed to open git stdin".to_string()))?;
        stdin
            .write_all(patch.as_bytes())
            .await
            .map_err(|e| AppError::Git(e.to_string()))?;
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Git(e.to_string()))?;
    if !output.status.success() {
        return Err(AppError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

/// Commit the staged changes with `message` (`git commit -m`). With `amend`,
/// rewrites the current `HEAD` commit instead of creating a new one
/// (`git commit --amend -m`), which also works to reword with nothing staged.
/// With `sign_off`, appends a `Signed-off-by:` trailer using the configured git
/// identity (`-s`). Without `amend`, fails (surfaced to the user) when nothing is
/// staged.
pub async fn commit(
    worktree_path: &str,
    message: &str,
    amend: bool,
    sign_off: bool,
) -> Result<(), AppError> {
    let mut args = vec!["commit", "-m", message];
    if amend {
        args.push("--amend");
    }
    if sign_off {
        args.push("-s");
    }
    git(worktree_path, &args).await.map(|_| ())
}

/// Push the current branch (`git push`). Never retried (not idempotent).
pub async fn push(worktree_path: &str) -> Result<(), AppError> {
    git(worktree_path, &["push"]).await.map(|_| ())
}

/// Pull with fast-forward only (`git pull --ff-only`), so a pull never starts a
/// surprise merge; the user resolves diverged history explicitly.
pub async fn pull(worktree_path: &str) -> Result<(), AppError> {
    git(worktree_path, &["pull", "--ff-only"]).await.map(|_| ())
}

// --- History log & commit show (right-panel "History" tab) -----------------

/// Field separator (US) and record separator (RS) used in the `git log` pretty
/// format. Both are control chars that never appear in a commit message, so they
/// parse a multi-line body unambiguously.
const LOG_FIELD_SEP: char = '\u{1f}';
const LOG_RECORD_SEP: char = '\u{1e}';

/// The `--pretty=format:` template for [`log_cli`], matching the field order
/// [`parse_log`] expects (hash, short, parents, name, email, time, refs, subject,
/// body), terminated by the record separator.
const LOG_FORMAT: &str = "format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b%x1e";

/// List the worktree's commit history (newest first, topological), `limit`
/// commits starting `skip` from `HEAD`. Fast path: `git2` revwalk; CLI fallback
/// (`git log --topo-order`). An unborn `HEAD` (a repo with no commits) yields an
/// empty list rather than an error.
pub async fn log(
    worktree_path: &str,
    limit: usize,
    skip: usize,
) -> Result<Vec<CommitInfo>, AppError> {
    // WSL repos go straight to the CLI (routed through wsl.exe); see worktree_status.
    if !crate::wsl::is_wsl_path(worktree_path) {
        let p = worktree_path.to_string();
        if let Ok(Ok(v)) =
            tokio::task::spawn_blocking(move || crate::gitfast::log(&p, limit, skip)).await
        {
            return Ok(v);
        }
    }
    log_cli(worktree_path, limit, skip).await
}

/// CLI fallback for [`log`]. Tolerates the "no commits yet" case (empty list).
async fn log_cli(
    worktree_path: &str,
    limit: usize,
    skip: usize,
) -> Result<Vec<CommitInfo>, AppError> {
    let limit_s = limit.to_string();
    let skip_s = format!("--skip={skip}");
    let pretty = format!("--pretty={LOG_FORMAT}");
    let out = match git(
        worktree_path,
        &[
            "log",
            "--topo-order",
            &skip_s,
            "-n",
            &limit_s,
            "--decorate=short",
            &pretty,
        ],
    )
    .await
    {
        Ok(out) => out,
        // A fresh repo with no commits: not an error for the history view.
        Err(AppError::Git(e)) if e.contains("does not have any commits") => String::new(),
        Err(e) => return Err(e),
    };
    Ok(parse_log(&out))
}

/// Parse the `git log` output produced by [`LOG_FORMAT`] into [`CommitInfo`]s.
/// Records are RS-separated; fields within a record are US-separated.
pub fn parse_log(input: &str) -> Vec<CommitInfo> {
    let mut out = Vec::new();
    for record in input.split(LOG_RECORD_SEP) {
        // Trim the inter-record newline git inserts; skip the trailing empty one.
        let record = record.trim_matches(['\n', '\r']);
        if record.is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.split(LOG_FIELD_SEP).collect();
        if fields.len() < 9 {
            continue;
        }
        out.push(CommitInfo {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            parents: fields[2].split_whitespace().map(str::to_string).collect(),
            author_name: fields[3].to_string(),
            author_email: fields[4].to_string(),
            timestamp: fields[5].trim().parse().unwrap_or(0),
            refs: parse_refs(fields[6]),
            subject: fields[7].to_string(),
            body: fields[8].trim_end().to_string(),
        });
    }
    out
}

/// Parse `git log`'s `%D` decoration field (e.g. `HEAD -> main, origin/main,
/// tag: v1.0`) into a flat list of labels. `HEAD -> x` becomes `HEAD` + `x`;
/// `tag: x` is kept as `tag: x` so the frontend can style tags distinctly.
fn parse_refs(input: &str) -> Vec<String> {
    input
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .flat_map(|p| match p.split_once("->") {
            Some((head, branch)) => vec![head.trim().to_string(), branch.trim().to_string()],
            None => vec![p.to_string()],
        })
        .collect()
}

/// Unified diff a single commit introduced (its first-parent diff). `hash` is
/// validated as hex before use. Fast path: `git2`; CLI fallback (`git show`).
pub async fn show(worktree_path: &str, hash: &str) -> Result<String, AppError> {
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Invalid(format!("invalid commit hash: {hash}")));
    }
    // WSL repos go straight to the CLI (routed through wsl.exe); see worktree_status.
    if !crate::wsl::is_wsl_path(worktree_path) {
        let (p, h) = (worktree_path.to_string(), hash.to_string());
        if let Ok(Ok(v)) = tokio::task::spawn_blocking(move || crate::gitfast::show(&p, &h)).await {
            if !v.trim().is_empty() {
                return Ok(v);
            }
        }
    }
    git(worktree_path, &["show", "--format=", "-p", hash]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_with_main_and_worktrees() {
        let input = "worktree /repo/main\nHEAD aaa111\nbranch refs/heads/main\n\nworktree /repo--feature\nHEAD bbb222\nbranch refs/heads/feature/x\n\nworktree /repo--detached\nHEAD ccc333\ndetached\n";
        let entries = parse_worktree_porcelain(input);
        assert_eq!(entries.len(), 3);

        assert_eq!(entries[0].path, "/repo/main");
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert!(entries[0].is_main);

        assert_eq!(entries[1].branch.as_deref(), Some("feature/x"));
        assert!(!entries[1].is_main);

        assert_eq!(entries[2].branch, None); // detached
        assert_eq!(entries[2].head.as_deref(), Some("ccc333"));
    }

    #[test]
    fn empty_output_yields_no_entries() {
        assert!(parse_worktree_porcelain("").is_empty());
    }

    #[test]
    fn worktree_path_flattens_branch_separators() {
        let p = worktree_path_for("/home/u/myrepo", "feature/login");
        assert!(p.ends_with("myrepo--feature-login"));
        assert!(p.contains("/home/u") || p.contains("\\home\\u"));
    }

    #[test]
    fn repo_name_is_final_component() {
        assert_eq!(repo_name("/home/u/myrepo"), "myrepo");
    }

    #[test]
    fn worktree_path_for_stays_under_wsl_unc_prefix() {
        // A WSL repo's worktree must remain a sibling under the same UNC share so
        // the path keeps parsing as WSL (and routes through wsl.exe).
        let p = worktree_path_for("//wsl.localhost/Ubuntu/home/u/myrepo", "feature/login");
        assert!(p.ends_with("myrepo--feature-login"), "got {p}");
        assert!(p.contains("wsl.localhost/Ubuntu/home/u"), "got {p}");
        assert!(
            crate::wsl::parse(&p).is_some(),
            "result should still parse as WSL"
        );
    }

    #[test]
    fn parses_status_dirty_and_ahead_behind() {
        let input =
            "## main...origin/main [ahead 2, behind 1]\n M src/a.rs\n?? new.txt\nA  added.rs\n";
        let s = parse_status_porcelain(input);
        assert_eq!(s.dirty, 3);
        assert_eq!(s.ahead, 2);
        assert_eq!(s.behind, 1);
    }

    #[test]
    fn parses_status_clean_no_upstream() {
        let s = parse_status_porcelain("## main\n");
        assert_eq!(s, WorktreeStatus::default());
    }

    #[test]
    fn branch_lines_are_trimmed_and_deblanked() {
        let input = "main\n feature/x \n\nrelease/1.0\n";
        assert_eq!(
            parse_branch_lines(input),
            vec!["main", "feature/x", "release/1.0"]
        );
    }

    #[test]
    fn parses_status_files_codes_and_paths() {
        // NUL-separated: staged-modified, unstaged-modified, untracked, staged-add.
        let input = "M  src/a.rs\0 M src/b.rs\0?? new file.txt\0A  added.rs\0";
        let files = parse_status_files(input);
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].path, "src/a.rs");
        assert_eq!(
            (files[0].index.as_str(), files[0].worktree.as_str()),
            ("M", " ")
        );
        assert_eq!(
            (files[1].index.as_str(), files[1].worktree.as_str()),
            (" ", "M")
        );
        assert_eq!(files[2].path, "new file.txt");
        assert_eq!(files[2].index, "?");
        assert_eq!(files[3].index, "A");
    }

    #[test]
    fn parses_status_files_consumes_rename_orig_path() {
        // A rename entry is followed by the original path in the next NUL field.
        let input = "R  new.rs\0old.rs\0 M other.rs\0";
        let files = parse_status_files(input);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].index, "R");
        assert_eq!(files[0].path, "new.rs"); // orig "old.rs" consumed, not its own entry
        assert_eq!(files[1].path, "other.rs");
    }

    #[test]
    fn parses_status_files_empty() {
        assert!(parse_status_files("").is_empty());
    }

    #[test]
    fn parses_numstat_counts_and_binary() {
        let input = "3\t1\tsrc/a.rs\n0\t5\tsrc/b.rs\n-\t-\timg.png\n";
        let stats = parse_numstat(input);
        assert_eq!(stats.len(), 3);
        assert_eq!((stats[0].added, stats[0].deleted), (3, 1));
        assert_eq!(stats[0].path, "src/a.rs");
        assert_eq!((stats[1].added, stats[1].deleted), (0, 5));
        // Binary "-\t-" parses to 0/0.
        assert_eq!((stats[2].added, stats[2].deleted), (0, 0));
        assert_eq!(stats[2].path, "img.png");
    }

    #[test]
    fn parses_numstat_empty() {
        assert!(parse_numstat("").is_empty());
    }

    #[test]
    fn parses_log_records_fields_and_merges() {
        // Two records (US between fields, RS terminates each). The second is a
        // merge (two parents) with a multi-line body and a HEAD/branch decoration.
        let input = "h1\u{1f}h1s\u{1f}p0\u{1f}Ann\u{1f}ann@x\u{1f}1700000000\u{1f}\u{1f}first\u{1f}\u{1e}\nh2\u{1f}h2s\u{1f}p1 p0\u{1f}Bob\u{1f}bob@x\u{1f}1700000100\u{1f}HEAD -> main, tag: v1\u{1f}merge branch\u{1f}line one\nline two\u{1e}\n";
        let commits = parse_log(input);
        assert_eq!(commits.len(), 2);

        assert_eq!(commits[0].hash, "h1");
        assert_eq!(commits[0].short_hash, "h1s");
        assert_eq!(commits[0].parents, vec!["p0"]);
        assert_eq!(commits[0].author_name, "Ann");
        assert_eq!(commits[0].timestamp, 1700000000);
        assert_eq!(commits[0].subject, "first");
        assert!(commits[0].body.is_empty());
        assert!(commits[0].refs.is_empty());

        assert_eq!(commits[1].parents, vec!["p1", "p0"]); // merge
        assert_eq!(commits[1].body, "line one\nline two");
        assert_eq!(commits[1].refs, vec!["HEAD", "main", "tag: v1"]);
    }

    #[test]
    fn parses_log_empty() {
        assert!(parse_log("").is_empty());
        assert!(parse_log("\n").is_empty());
    }

    #[test]
    fn parse_refs_splits_head_arrow_and_keeps_tags() {
        assert_eq!(
            parse_refs("HEAD -> main, origin/main, tag: v1.0"),
            vec!["HEAD", "main", "origin/main", "tag: v1.0"]
        );
        assert!(parse_refs("").is_empty());
    }

    // --- Squash-merge branch cleanup (integration; needs the git CLI) ---------

    /// Run a git command in `dir`, panicking with context on failure.
    async fn run_git(dir: &str, args: &[&str]) {
        git(dir, args)
            .await
            .unwrap_or_else(|e| panic!("git {args:?} in {dir} failed: {e:?}"));
    }

    /// Init a repo on `main` with a deterministic identity and signing off, plus
    /// one initial commit so branches have a shared base.
    async fn init_repo(dir: &str) {
        run_git(dir, &["init", "-b", "main"]).await;
        run_git(dir, &["config", "user.email", "test@uxnan.dev"]).await;
        run_git(dir, &["config", "user.name", "Uxnan Test"]).await;
        run_git(dir, &["config", "commit.gpgsign", "false"]).await;
        std::fs::write(format!("{dir}/README.md"), "base\n").unwrap();
        run_git(dir, &["add", "-A"]).await;
        run_git(dir, &["commit", "-m", "initial"]).await;
    }

    #[tokio::test]
    async fn remove_worktree_force_deletes_squash_merged_branch() {
        let repo = tempfile::tempdir().unwrap();
        let repo_path = repo.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo_path).await;

        // A feature worktree with its own commit.
        let wt = worktree_path_for(&repo_path, "feature");
        add_worktree(&repo_path, "feature", &wt, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{wt}/feature.txt"), "hello\n").unwrap();
        run_git(&wt, &["add", "-A"]).await;
        run_git(&wt, &["commit", "-m", "add feature"]).await;

        // Squash-merge it into main: the same net diff, a different commit — so
        // `git branch -d feature` would refuse it.
        run_git(&repo_path, &["merge", "--squash", "feature"]).await;
        run_git(&repo_path, &["commit", "-m", "squash feature"]).await;

        let outcome = remove_worktree(&repo_path, &wt, Some("feature"), false)
            .await
            .unwrap();
        assert!(outcome.branch_deleted, "branch should be deleted");
        assert!(outcome.squash_merged, "via squash-merge detection");
        assert!(!outcome.branch_preserved);
        // The branch is really gone.
        let branches = list_branches(&repo_path).await.unwrap();
        assert!(!branches.iter().any(|b| b == "feature"));
    }

    #[tokio::test]
    async fn remove_worktree_keeps_genuinely_unmerged_branch() {
        let repo = tempfile::tempdir().unwrap();
        let repo_path = repo.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo_path).await;

        let wt = worktree_path_for(&repo_path, "wip");
        add_worktree(&repo_path, "wip", &wt, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{wt}/wip.txt"), "unmerged\n").unwrap();
        run_git(&wt, &["add", "-A"]).await;
        run_git(&wt, &["commit", "-m", "wip work"]).await;

        // Never merged anywhere → the branch must be preserved (no work lost).
        let outcome = remove_worktree(&repo_path, &wt, Some("wip"), false)
            .await
            .unwrap();
        assert!(outcome.branch_preserved, "unmerged branch is kept");
        assert!(!outcome.branch_deleted);
        assert!(!outcome.squash_merged);
        let branches = list_branches(&repo_path).await.unwrap();
        assert!(branches.iter().any(|b| b == "wip"));
    }
}
