//! Git operations for repos and worktrees.
//!
//! Phase 2 uses the git **CLI** (via `tokio::process::Command`, `shell:false` —
//! args are passed as a vector, never interpolated) for worktree management,
//! which libgit2 only supports partially. High-frequency status/diff work will
//! move to the `git2` crate in later phases (spec §2.5).

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

/// Run `git` in `repo_path` and return stdout on success, mapping a non-zero
/// exit (with stderr) to [`AppError::Git`].
async fn git(repo_path: &str, args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
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
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
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
pub fn worktree_path_for(repo_path: &str, branch: &str) -> String {
    let repo = Path::new(repo_path);
    let parent = repo.parent().unwrap_or(repo);
    let name = repo_name(repo_path);
    let safe_branch = branch.replace(['/', '\\'], "-");
    parent
        .join(format!("{name}--{safe_branch}"))
        .to_string_lossy()
        .to_string()
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
/// for its sidebar card. Uses `status --porcelain=v1 --branch`.
pub async fn worktree_status(worktree_path: &str) -> Result<WorktreeStatus, AppError> {
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
/// administrative files and attempts a *safe* branch delete (`git branch -d`,
/// which fails — and is ignored — when the branch has unmerged commits, so work
/// is never lost). Patch-equivalence detection for squash-merged branches is
/// deferred (FOR-DEV: aggressive branch cleanup).
pub async fn remove_worktree(
    repo_path: &str,
    worktree_path: &str,
    branch: Option<&str>,
    force: bool,
) -> Result<(), AppError> {
    if !force && !is_worktree_clean(worktree_path).await? {
        return Err(AppError::Invalid(
            "worktree has uncommitted changes; commit, stash, or force-remove".to_string(),
        ));
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    git(repo_path, &args).await?;
    // Best-effort cleanup; never fail the removal because pruning/branch delete
    // hit a snag.
    let _ = git(repo_path, &["worktree", "prune"]).await;
    if let Some(branch) = branch {
        let _ = git(repo_path, &["branch", "-d", branch]).await;
    }
    Ok(())
}

/// List all worktrees of a repo (ADE-created and external).
pub async fn list_worktrees(repo_path: &str) -> Result<Vec<WorktreeEntry>, AppError> {
    let out = git(repo_path, &["worktree", "list", "--porcelain"]).await?;
    Ok(parse_worktree_porcelain(&out))
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

/// List a worktree's changed files (`git status --porcelain=v1 -z
/// --untracked-files=all`). NUL-terminated so paths with spaces/newlines are
/// safe; rename/copy entries carry the original path in a trailing NUL field.
pub async fn status_files(worktree_path: &str) -> Result<Vec<FileChange>, AppError> {
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
/// the worktree-vs-index diff, falling back to a whole-file "added" diff for an
/// untracked file (which has no tracked diff).
pub async fn diff_file(worktree_path: &str, file: &str, staged: bool) -> Result<String, AppError> {
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

/// Commit the staged changes with `message` (`git commit -m`). Fails (surfaced to
/// the user) when nothing is staged.
pub async fn commit(worktree_path: &str, message: &str) -> Result<(), AppError> {
    git(worktree_path, &["commit", "-m", message])
        .await
        .map(|_| ())
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
}
