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
    fn branch_lines_are_trimmed_and_deblanked() {
        let input = "main\n feature/x \n\nrelease/1.0\n";
        assert_eq!(
            parse_branch_lines(input),
            vec!["main", "feature/x", "release/1.0"]
        );
    }
}
