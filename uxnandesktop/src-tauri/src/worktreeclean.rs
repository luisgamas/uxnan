//! Finding — and safely removing — worktrees the app can prove are disposable.
//!
//! A managed root collects checkouts out of sight, and what is out of sight does
//! not get cleaned up: the sibling folders it replaced at least sat next to the
//! repository, annoying enough to prune by hand. This module is what keeps that
//! folder from growing forever.
//!
//! **It is deliberately narrow, and every limit here is a safety property:**
//!
//! - It only ever looks **inside a managed root** (the global one plus each
//!   project's override). A worktree beside its repository, or anywhere else the
//!   user put one, is never listed and never touched.
//! - It only offers what it can **prove** is disposable: a folder git no longer
//!   knows about, a clean checkout whose branch has landed or whose remote
//!   branch is gone, or one belonging to a repository that is no longer a
//!   project in the app. Anything with uncommitted work is listed **blocked**,
//!   so the answer to "why isn't this offered?" is on screen instead of absent.
//! - Nothing is automatic. The scan reports; the user picks; and every path is
//!   **re-verified from scratch** at removal time rather than trusted from the
//!   caller — a stale list must not be able to delete the wrong folder.
//! - Removal moves the directory into a trash folder inside the same root first
//!   (a rename: instant, and on the same volume by construction) and deletes it
//!   in the background. Deleting a checkout's `node_modules` in the foreground
//!   is tens of seconds of frozen UI.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::worktreeloc::{normalize, MARKER_FILE};

/// Folder each managed root parks removed worktrees in until the background
/// delete finishes. Hidden, and inside the root so the rename never crosses a
/// volume.
const TRASH_DIR: &str = ".uxnan-trash";

/// Why a candidate is offered — or refused. Serialized to the frontend, which
/// owns the wording.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanupReason {
    /// The repository this group belonged to is gone from disk.
    RepoGone,
    /// Git no longer lists this folder as one of the repository's worktrees.
    NotAWorktree,
    /// The branch has landed on its base (merge or squash-merge).
    Merged,
    /// The branch was pushed once and its remote-tracking branch is gone.
    BranchGone,
    /// The repository is still on disk, but it is no longer one of the app's
    /// projects — so nothing in uxnan leads here any more.
    ProjectRemoved,
    /// Blocked: the checkout has uncommitted or untracked changes.
    UncommittedChanges,
}

/// The bucket a candidate is shown in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanupKind {
    /// Git owns nothing here any more — safe, and pre-selected in the UI.
    Orphaned,
    /// A live, clean worktree whose work is done.
    Finished,
    /// A live, clean worktree of a repository the app no longer lists as a
    /// project. Removing a project does not touch the disk, so its worktrees
    /// stay behind — invisible to everything, since they are neither orphaned
    /// (git still owns them) nor finished (the branch may never have landed).
    /// **Not** pre-selected: the repository and the branch are both intact, so
    /// this is a judgement call, not garbage.
    Unregistered,
    /// Listed so the user sees it, never removable without dealing with it.
    Blocked,
}

/// One worktree the cleanup screen can show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCandidate {
    /// Absolute path, forward slashes (the spelling git reports).
    pub path: String,
    /// The group folder it sits in — the repository's name, for display.
    pub group: String,
    /// Folder name of the worktree itself, for display.
    pub name: String,
    pub branch: Option<String>,
    pub kind: CleanupKind,
    pub reason: CleanupReason,
    /// For [`CleanupReason::UncommittedChanges`], how many files are dirty.
    pub changed_files: Option<u32>,
    /// The repository it belongs to, when one could be resolved.
    pub repo_path: Option<String>,
}

/// What a removal run actually did.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupOutcome {
    pub removed: Vec<String>,
    /// Paths that were refused, each with the reason, so the UI can say which
    /// ones survived and why instead of reporting a silent partial success.
    pub refused: Vec<CleanupRefusal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRefusal {
    pub path: String,
    pub reason: String,
}

/// Whether `path` is inside `root` — the containment check every removal passes
/// before anything is touched. Compares normalized, case-folded prefixes and
/// requires a separator, so `/roots/uxnan-evil` is not "inside" `/roots/uxnan`.
pub fn is_inside(root: &str, path: &str) -> bool {
    let root = normalize(root).to_lowercase();
    let path = normalize(path).to_lowercase();
    path.len() > root.len() + 1
        && path.starts_with(&root)
        && path.as_bytes().get(root.len()) == Some(&b'/')
}

/// Scan `roots` for worktrees worth offering. Read-only.
///
/// `projects` is the paths of the repositories the app currently lists. A
/// worktree whose repository is not among them is reported
/// [`CleanupKind::Unregistered`]: removing a project from uxnan touches nothing
/// on disk, so its worktrees stay behind — and without this they are invisible
/// to the cleanup forever, being neither orphaned (git still owns them) nor
/// finished (the branch may never have landed).
pub async fn scan(roots: &[String], projects: &[String]) -> Vec<CleanupCandidate> {
    let known: Vec<String> = projects
        .iter()
        .map(|p| normalize(p).to_lowercase())
        .collect();
    let mut found: Vec<CleanupCandidate> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for root in roots {
        let root = normalize(root);
        for group in read_dirs(&root).await {
            if group.name == TRASH_DIR {
                continue;
            }
            let repo = marker_repo(&group.path).await;
            for entry in read_dirs(&group.path).await {
                if seen.contains(&entry.path) {
                    continue;
                }
                seen.push(entry.path.clone());
                if let Some(candidate) =
                    classify(&group.name, &entry, repo.as_deref(), &known).await
                {
                    found.push(candidate);
                }
            }
        }
    }
    found
}

/// How many worktree folders sit in `roots`, counting directories only.
///
/// Deliberately git-free and disk-cheap: it is what decides whether the status
/// bar mentions the folder at all, and that question is asked at startup. The
/// real scan — a `git worktree list` per group plus a status and a merge check
/// per worktree — runs only when the user opens the cleanup section. Measuring
/// the folder's *size* would be worse still: walking a checkout's
/// `node_modules` is the single most expensive thing in this module.
pub async fn count(roots: &[String]) -> u32 {
    let mut total = 0;
    for root in roots {
        for group in read_dirs(&normalize(root)).await {
            if group.name == TRASH_DIR {
                continue;
            }
            total += read_dirs(&group.path).await.len() as u32;
        }
    }
    total
}

/// A directory entry we care about: a real sub-directory, never a symlink (a
/// link could point anywhere, and this module's whole premise is that it only
/// ever works inside a root it owns).
struct Dir {
    path: String,
    name: String,
}

async fn read_dirs(parent: &str) -> Vec<Dir> {
    let mut out = Vec::new();
    let Ok(mut reader) = tokio::fs::read_dir(parent).await else {
        return out;
    };
    while let Ok(Some(item)) = reader.next_entry().await {
        let Ok(meta) = item.metadata().await else {
            continue;
        };
        // `metadata()` follows links; `symlink_metadata` sees the link itself.
        let is_link = tokio::fs::symlink_metadata(item.path())
            .await
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true);
        if !meta.is_dir() || is_link {
            continue;
        }
        out.push(Dir {
            path: normalize(&item.path().to_string_lossy()),
            name: item.file_name().to_string_lossy().to_string(),
        });
    }
    out.sort_by_key(|d| d.name.to_lowercase());
    out
}

/// The repository a group folder was claimed by, per its marker file.
async fn marker_repo(group_path: &str) -> Option<String> {
    let contents = tokio::fs::read_to_string(format!("{group_path}/{MARKER_FILE}"))
        .await
        .ok()?;
    let path = normalize(contents.trim());
    (!path.is_empty()).then_some(path)
}

/// Decide what, if anything, to report about one folder inside a group.
/// `known_projects` is normalized, lowercased repository paths.
async fn classify(
    group: &str,
    entry: &Dir,
    repo: Option<&str>,
    known_projects: &[String],
) -> Option<CleanupCandidate> {
    let make = |kind, reason, branch, changed_files, repo_path| CleanupCandidate {
        path: entry.path.clone(),
        group: group.to_string(),
        name: entry.name.clone(),
        branch,
        kind,
        reason,
        changed_files,
        repo_path,
    };

    // No repository left to ask: the whole group is stranded.
    let Some(repo) = repo.filter(|r| Path::new(r).is_dir()) else {
        return Some(make(
            CleanupKind::Orphaned,
            CleanupReason::RepoGone,
            None,
            None,
            None,
        ));
    };

    let listed = crate::git::list_worktrees(repo).await.unwrap_or_default();
    let Some(worktree) = listed
        .iter()
        .find(|e| normalize(&e.path).to_lowercase() == entry.path.to_lowercase())
    else {
        // The folder is inside our root but git does not own it — a worktree
        // removed from elsewhere, or a leftover from an interrupted create.
        return Some(make(
            CleanupKind::Orphaned,
            CleanupReason::NotAWorktree,
            None,
            None,
            Some(repo.to_string()),
        ));
    };

    // Never offer a repository's primary checkout, wherever it happens to live.
    if worktree.is_main {
        return None;
    }

    match crate::git::status_files(&entry.path).await {
        Ok(files) if !files.is_empty() => {
            return Some(make(
                CleanupKind::Blocked,
                CleanupReason::UncommittedChanges,
                worktree.branch.clone(),
                Some(files.len() as u32),
                Some(repo.to_string()),
            ));
        }
        // An unreadable status is not a licence to delete: say nothing.
        Err(_) => return None,
        _ => {}
    }

    let branch = worktree.branch.clone()?;
    if crate::git::branch_integrated(repo, &branch).await {
        return Some(make(
            CleanupKind::Finished,
            CleanupReason::Merged,
            Some(branch),
            None,
            Some(repo.to_string()),
        ));
    }
    if upstream_gone(repo, &branch).await {
        return Some(make(
            CleanupKind::Finished,
            CleanupReason::BranchGone,
            Some(branch),
            None,
            Some(repo.to_string()),
        ));
    }
    // Last: the work says nothing, but nothing in the app leads here any more.
    // Checked after the two above because "it landed" is a stronger statement
    // about the checkout than "you closed the project".
    if !known_projects.contains(&normalize(repo).to_lowercase()) {
        return Some(make(
            CleanupKind::Unregistered,
            CleanupReason::ProjectRemoved,
            Some(branch),
            None,
            Some(repo.to_string()),
        ));
    }
    None
}

/// Whether `branch` was pushed once and its remote-tracking branch has since
/// disappeared — the shape a merged-and-deleted PR leaves behind.
///
/// Both halves matter. A branch with **no** upstream was simply never pushed,
/// which says nothing about whether the work is done; asking only "is there a
/// remote ref?" would offer to delete every local-only branch. Read from the
/// last fetch, never from the network: a cleanup screen must not depend on
/// being online, and a fetch here would be a surprise side effect.
async fn upstream_gone(repo_path: &str, branch: &str) -> bool {
    let configured = crate::git::config_get(repo_path, &format!("branch.{branch}.merge"))
        .await
        .is_some();
    if !configured {
        return false;
    }
    !crate::git::ref_exists(repo_path, &format!("refs/remotes/origin/{branch}")).await
}

/// Total size on disk of a directory tree, in bytes. Best-effort: unreadable
/// entries are skipped rather than failing the whole figure.
///
/// Run on the blocking pool — a checkout's `node_modules` is tens of thousands
/// of files, and this is the reason sizes are fetched separately from the scan
/// instead of holding the list back.
pub async fn dir_size(path: String) -> u64 {
    tokio::task::spawn_blocking(move || walk_size(Path::new(&path)))
        .await
        .unwrap_or(0)
}

fn walk_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_symlink() {
            continue;
        }
        total += if meta.is_dir() {
            walk_size(&entry.path())
        } else {
            meta.len()
        };
    }
    total
}

/// Remove the given worktrees, re-deriving every fact rather than trusting the
/// caller's list.
///
/// Each path must (1) sit inside one of `roots`, and (2) still be a candidate
/// the scan classifies as removable. A path that fails either check is refused
/// with a reason instead of being skipped silently — a cleanup that quietly
/// does less than it said is worse than one that explains itself.
pub async fn remove(roots: &[String], projects: &[String], paths: &[String]) -> CleanupOutcome {
    let mut outcome = CleanupOutcome::default();
    let candidates = scan(roots, projects).await;

    for path in paths {
        let path = normalize(path);
        if !roots.iter().any(|root| is_inside(root, &path)) {
            outcome.refused.push(CleanupRefusal {
                path,
                reason: "outside the managed worktree folder".to_string(),
            });
            continue;
        }
        let Some(candidate) = candidates.iter().find(|c| c.path == path) else {
            outcome.refused.push(CleanupRefusal {
                path,
                reason: "no longer qualifies for cleanup".to_string(),
            });
            continue;
        };
        if candidate.kind == CleanupKind::Blocked {
            outcome.refused.push(CleanupRefusal {
                path,
                reason: "has uncommitted changes".to_string(),
            });
            continue;
        }
        // Last gate before anything is touched: ask git again. The scan may be
        // seconds old, and an agent writes files the whole time.
        if matches!(
            candidate.kind,
            CleanupKind::Finished | CleanupKind::Unregistered
        ) && !matches!(crate::git::is_worktree_clean(&path).await, Ok(true))
        {
            outcome.refused.push(CleanupRefusal {
                path,
                reason: "has uncommitted changes".to_string(),
            });
            continue;
        }

        match retire(&path).await {
            Ok(()) => {
                if let Some(repo) = &candidate.repo_path {
                    crate::git::prune_worktrees(repo).await;
                }
                outcome.removed.push(path);
            }
            Err(e) => outcome.refused.push(CleanupRefusal {
                path,
                reason: e.to_string(),
            }),
        }
    }
    outcome
}

/// Move a worktree out of the way, then delete it in the background.
///
/// The rename is what makes "clean up" feel instant: the directory disappears
/// from the list immediately, and the tens of seconds it takes to unlink a
/// `node_modules` happen after the user has moved on. The trash folder lives
/// inside the same root, so the rename is always within one volume.
async fn retire(path: &str) -> Result<(), AppError> {
    let parent = Path::new(path)
        .parent()
        .ok_or_else(|| AppError::Invalid("no parent directory".to_string()))?;
    let root = parent
        .parent()
        .ok_or_else(|| AppError::Invalid("no managed root".to_string()))?;
    let trash = root.join(TRASH_DIR);
    tokio::fs::create_dir_all(&trash).await?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = trash.join(format!("wt-{stamp}-{}", uuid::Uuid::new_v4().simple()));

    match tokio::fs::rename(path, &target).await {
        Ok(()) => {
            tokio::spawn(async move {
                let _ = tokio::fs::remove_dir_all(&target).await;
            });
            Ok(())
        }
        // A rename can fail on Windows while anything holds a handle inside the
        // tree. Deleting in place is slower but correct.
        Err(_) => tokio::fs::remove_dir_all(path).await.map_err(AppError::Io),
    }
}

/// Delete trash left behind by a run that was interrupted (a crash, a kill, or
/// the app closing before a background delete finished). Only entries whose
/// name this module generated are removed, inside a trash folder inside a
/// managed root — never anything else.
pub async fn sweep_trash(roots: &[String]) -> u32 {
    let mut swept = 0;
    for root in roots {
        let trash = format!("{}/{TRASH_DIR}", normalize(root));
        for entry in read_dirs(&trash).await {
            if !is_trash_entry(&entry.name) {
                continue;
            }
            if tokio::fs::remove_dir_all(&entry.path).await.is_ok() {
                swept += 1;
            }
        }
    }
    swept
}

/// Whether a name is one [`retire`] generated (`wt-<millis>-<32 hex>`). The
/// pattern is the whole safety of the sweep: it never deletes a folder just
/// because of where it sits.
fn is_trash_entry(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("wt-") else {
        return false;
    };
    let Some((stamp, nonce)) = rest.split_once('-') else {
        return false;
    };
    !stamp.is_empty()
        && stamp.chars().all(|c| c.is_ascii_digit())
        && nonce.len() == 32
        && nonce.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn containment_requires_a_real_path_boundary() {
        assert!(is_inside("/roots/uxnan", "/roots/uxnan/api/feat"));
        assert!(is_inside(r"C:\Roots\Uxnan", "c:/roots/uxnan/api"));
        // A sibling that merely shares a prefix is NOT inside.
        assert!(!is_inside("/roots/uxnan", "/roots/uxnan-evil/api"));
        // The root itself is not inside itself.
        assert!(!is_inside("/roots/uxnan", "/roots/uxnan"));
        assert!(!is_inside("/roots/uxnan", "/elsewhere/api"));
    }

    #[test]
    fn only_generated_trash_names_are_swept() {
        let nonce = "0123456789abcdef0123456789abcdef";
        assert!(is_trash_entry(&format!("wt-1786570000000-{nonce}")));
        // Anything a user could plausibly have put there is left alone.
        assert!(!is_trash_entry("wt-notatimestamp-0123"));
        assert!(!is_trash_entry("my-backup"));
        assert!(!is_trash_entry("wt-1786570000000-short"));
        assert!(!is_trash_entry(&format!("WT-1786570000000-{nonce}")));
        assert!(!is_trash_entry("wt-"));
    }

    async fn run_git(dir: &str, args: &[&str]) {
        let out = crate::winproc::command("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .await
            .unwrap();
        assert!(out.status.success(), "git {args:?}");
    }

    async fn init_repo(dir: &str) {
        run_git(dir, &["init", "-b", "main"]).await;
        run_git(dir, &["config", "user.email", "test@uxnan.dev"]).await;
        run_git(dir, &["config", "user.name", "Uxnan Test"]).await;
        run_git(dir, &["config", "commit.gpgsign", "false"]).await;
        std::fs::write(format!("{dir}/README.md"), "base\n").unwrap();
        run_git(dir, &["add", "-A"]).await;
        run_git(dir, &["commit", "-m", "initial"]).await;
    }

    /// A managed root holding one repo's group, with the marker in place.
    async fn managed_root(repo: &str) -> (tempfile::TempDir, String, String) {
        let root_dir = tempfile::tempdir().unwrap();
        let root = root_dir.path().to_string_lossy().replace('\\', "/");
        let group = format!("{root}/{}", crate::worktreeloc::repo_key(repo));
        tokio::fs::create_dir_all(&group).await.unwrap();
        tokio::fs::write(format!("{group}/{MARKER_FILE}"), repo)
            .await
            .unwrap();
        (root_dir, root, group)
    }

    #[tokio::test]
    async fn a_folder_git_does_not_own_is_reported_orphaned() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;

        // A leftover from an interrupted create: a directory, but no worktree.
        tokio::fs::create_dir_all(format!("{group}/stray"))
            .await
            .unwrap();

        let found = scan(&[root], std::slice::from_ref(&repo)).await;
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].kind, CleanupKind::Orphaned);
        assert_eq!(found[0].reason, CleanupReason::NotAWorktree);
    }

    #[tokio::test]
    async fn a_group_whose_repository_vanished_is_orphaned() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;
        tokio::fs::create_dir_all(format!("{group}/feat"))
            .await
            .unwrap();
        drop(repo_dir); // the repository is deleted from disk

        let found = scan(&[root], std::slice::from_ref(&repo)).await;
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].reason, CleanupReason::RepoGone);
    }

    #[tokio::test]
    async fn a_clean_merged_worktree_is_offered_and_a_dirty_one_is_blocked() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;

        // A branch that did work and landed on main.
        let merged = format!("{group}/done");
        crate::git::add_worktree(&repo, "done", &merged, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{merged}/f.txt"), "work\n").unwrap();
        run_git(&merged, &["add", "-A"]).await;
        run_git(&merged, &["commit", "-m", "work"]).await;
        run_git(&repo, &["merge", "--no-ff", "-m", "merge", "done"]).await;

        // A branch with work in progress.
        let dirty = format!("{group}/wip");
        crate::git::add_worktree(&repo, "wip", &dirty, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{dirty}/scratch.txt"), "unsaved\n").unwrap();

        let found = scan(&[root], std::slice::from_ref(&repo)).await;
        let done = found.iter().find(|c| c.name == "done").expect("done");
        assert_eq!(done.kind, CleanupKind::Finished);
        assert_eq!(done.reason, CleanupReason::Merged);

        let wip = found.iter().find(|c| c.name == "wip").expect("wip");
        assert_eq!(wip.kind, CleanupKind::Blocked);
        assert_eq!(wip.reason, CleanupReason::UncommittedChanges);
        assert_eq!(wip.changed_files, Some(1));
    }

    #[tokio::test]
    async fn an_untouched_branch_is_not_offered() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;

        // Created this morning, nothing done in it, never pushed: not finished,
        // and offering it would be offering to delete work that never happened.
        crate::git::add_worktree(&repo, "fresh", &format!("{group}/fresh"), Some("main"))
            .await
            .unwrap();

        assert!(scan(&[root], std::slice::from_ref(&repo)).await.is_empty());
    }

    #[tokio::test]
    async fn a_worktree_of_a_closed_project_is_offered_but_not_pre_selected() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;

        // Created and never touched — exactly what the sidebar would call
        // unfinished, so none of the other rules sees it.
        crate::git::add_worktree(&repo, "fresh", &format!("{group}/fresh"), Some("main"))
            .await
            .unwrap();
        assert!(
            scan(std::slice::from_ref(&root), std::slice::from_ref(&repo))
                .await
                .is_empty()
        );

        // Remove the project from the app (which touches nothing on disk) and
        // it becomes the one thing that DOES say this checkout is disposable.
        let found = scan(std::slice::from_ref(&root), &[]).await;
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].kind, CleanupKind::Unregistered);
        assert_eq!(found[0].reason, CleanupReason::ProjectRemoved);
        assert_eq!(found[0].branch.as_deref(), Some("fresh"));
    }

    #[tokio::test]
    async fn a_closed_project_with_unsaved_work_is_still_blocked() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;
        let dirty = format!("{group}/wip");
        crate::git::add_worktree(&repo, "wip", &dirty, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{dirty}/scratch.txt"), "unsaved\n").unwrap();

        // Closing the project must not downgrade the protection.
        let found = scan(std::slice::from_ref(&root), &[]).await;
        assert_eq!(found[0].kind, CleanupKind::Blocked);
        let outcome = remove(
            std::slice::from_ref(&root),
            &[],
            std::slice::from_ref(&dirty),
        )
        .await;
        assert!(outcome.removed.is_empty());
        assert!(Path::new(&dirty).is_dir(), "the worktree must survive");
    }

    #[tokio::test]
    async fn removal_refuses_a_path_outside_the_managed_root() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, _group) = managed_root(&repo).await;

        // The repository itself: inside no managed root, and the exact thing a
        // stale or forged list must never be able to delete.
        let outcome = remove(
            &[root],
            std::slice::from_ref(&repo),
            std::slice::from_ref(&repo),
        )
        .await;
        assert!(outcome.removed.is_empty());
        assert_eq!(outcome.refused.len(), 1);
        assert!(Path::new(&repo).is_dir(), "the repository must survive");
    }

    #[tokio::test]
    async fn removal_refuses_a_worktree_with_uncommitted_work() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;
        let dirty = format!("{group}/wip");
        crate::git::add_worktree(&repo, "wip", &dirty, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{dirty}/scratch.txt"), "unsaved\n").unwrap();

        let outcome = remove(
            &[root],
            std::slice::from_ref(&repo),
            std::slice::from_ref(&dirty),
        )
        .await;
        assert!(outcome.removed.is_empty());
        assert_eq!(outcome.refused.len(), 1);
        assert!(Path::new(&dirty).is_dir(), "the worktree must survive");
    }

    #[tokio::test]
    async fn removing_an_orphan_takes_the_folder_and_leaves_the_rest() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().to_string_lossy().replace('\\', "/");
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;
        let stray = format!("{group}/stray");
        tokio::fs::create_dir_all(format!("{stray}/nested"))
            .await
            .unwrap();
        tokio::fs::write(format!("{stray}/nested/f.txt"), "x")
            .await
            .unwrap();

        let outcome = remove(
            std::slice::from_ref(&root),
            std::slice::from_ref(&repo),
            std::slice::from_ref(&stray),
        )
        .await;
        assert_eq!(outcome.removed, vec![stray.clone()]);
        assert!(!Path::new(&stray).exists());
        // The group, its marker and the repository are untouched.
        assert!(Path::new(&format!("{group}/{MARKER_FILE}")).is_file());
        assert!(Path::new(&repo).is_dir());
    }

    #[tokio::test]
    async fn the_sweep_only_takes_folders_this_module_named() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = root_dir.path().to_string_lossy().replace('\\', "/");
        let trash = format!("{root}/{TRASH_DIR}");
        let generated = format!("{trash}/wt-1786570000000-0123456789abcdef0123456789abcdef");
        let foreign = format!("{trash}/please-keep-me");
        tokio::fs::create_dir_all(&generated).await.unwrap();
        tokio::fs::create_dir_all(&foreign).await.unwrap();

        assert_eq!(sweep_trash(&[root]).await, 1);
        assert!(!Path::new(&generated).exists());
        assert!(Path::new(&foreign).is_dir());
    }
}
