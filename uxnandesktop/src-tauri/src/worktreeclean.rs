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
    /// A cloned repository in the managed `repos` folder that is no longer a
    /// project, and whose every commit is already on a remote.
    CloneFullyPushed,
    /// Blocked: the checkout has uncommitted or untracked changes.
    UncommittedChanges,
    /// Blocked: local commits that exist on no remote. Deleting the folder
    /// would be the only copy gone.
    UnpushedCommits,
    /// Blocked: the repository has stashes, which live nowhere else.
    HasStashes,
    /// Blocked: no remote at all, so nothing here can be fetched again.
    NoRemote,
    /// Blocked: linked worktrees still point into this repository.
    HasWorktrees,
    /// Blocked: a terminal — and therefore possibly an agent — is live in it.
    InUse,
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
    /// A cloned repository, not a worktree. Its own bucket because the risk is
    /// not comparable: a worktree is a second checkout of history that lives in
    /// the repository, while this **is** the history. Only ever offered when
    /// every commit is already on a remote, so the folder can be cloned again.
    Clone,
    /// Listed so the user sees it, never removable without dealing with it.
    Blocked,
}

/// Which of the two things a candidate is. Stated by the backend rather than
/// inferred in the UI: a blocked row can be either, and "guess it from the
/// reason" breaks the moment both kinds share one — `uncommittedChanges`
/// already does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanupScope {
    Worktree,
    Clone,
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
    pub scope: CleanupScope,
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
pub async fn scan(roots: &[String], projects: &[String], busy: &[String]) -> Vec<CleanupCandidate> {
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
            // A worktree sitting DIRECTLY in the root — one made by hand, or
            // through the dialog's custom location. It is not a group, and
            // descending into it would offer its contents as if the project's
            // own directories were abandoned worktrees. They are the checkout.
            if is_work_tree(&group.path).await {
                if seen.contains(&group.path) {
                    continue;
                }
                seen.push(group.path.clone());
                if let Some(repo) = crate::git::main_worktree_of(&group.path).await {
                    if let Some(candidate) =
                        classify(&root, &group, Some(&repo), &known, busy).await
                    {
                        found.push(candidate);
                    }
                }
                continue;
            }
            let repo = marker_repo(&group.path).await;
            for entry in read_dirs(&group.path).await {
                if seen.contains(&entry.path) {
                    continue;
                }
                seen.push(entry.path.clone());
                if let Some(candidate) =
                    classify(&group.name, &entry, repo.as_deref(), &known, busy).await
                {
                    found.push(candidate);
                }
            }
        }
    }
    found
}

/// Scan the managed `repos` folder for **cloned repositories** that are no
/// longer projects in the app.
///
/// A repository is not a worktree, and the difference is the whole design here:
/// a worktree is a second checkout of history that lives in the repository, so
/// removing one costs a checkout. A clone **is** the history. Deleting it is
/// only recoverable if every commit already exists somewhere else, so that is
/// exactly the bar — one that can be *proved*, not estimated:
///
/// 1. it is not a registered project (nothing in the app leads there);
/// 2. the working tree is clean;
/// 3. no linked worktrees point into it (removing it would break them);
/// 4. no stashes — those live in no remote and no branch;
/// 5. it has a remote at all;
/// 6. **no commit on any local branch is missing from every remote.**
///
/// Anything that fails 2–6 is reported [`CleanupKind::Blocked`] with which gate
/// it failed, because "your repository has commits you never pushed" is worth
/// saying out loud far more than it is worth hiding.
///
/// Only ever looks inside `repos_root`. A repository the user keeps anywhere
/// else is never listed and never touched.
pub async fn scan_clones(
    repos_root: &str,
    projects: &[String],
    busy: &[String],
) -> Vec<CleanupCandidate> {
    let known: Vec<String> = projects
        .iter()
        .map(|p| normalize(p).to_lowercase())
        .collect();
    let root = normalize(repos_root);
    let mut found = Vec::new();

    for entry in read_dirs(&root).await {
        if entry.name == TRASH_DIR || known.contains(&entry.path.to_lowercase()) {
            continue;
        }
        // Not a git repository: a failed clone, or something the user put here
        // by hand. Guessing what it is would be guessing what to delete.
        if !crate::git::is_git_repo(&entry.path).await {
            continue;
        }
        let make = |kind, reason, changed_files| CleanupCandidate {
            path: entry.path.clone(),
            group: root.clone(),
            name: entry.name.clone(),
            branch: None,
            scope: CleanupScope::Clone,
            kind,
            reason,
            changed_files,
            repo_path: Some(entry.path.clone()),
        };

        if is_busy(&entry.path, busy) {
            found.push(make(CleanupKind::Blocked, CleanupReason::InUse, None));
            continue;
        }

        match crate::git::status_files(&entry.path).await {
            Ok(files) if !files.is_empty() => {
                found.push(make(
                    CleanupKind::Blocked,
                    CleanupReason::UncommittedChanges,
                    Some(files.len() as u32),
                ));
                continue;
            }
            // An unreadable status is not a licence to delete a repository.
            Err(_) => continue,
            _ => {}
        }

        let worktrees = crate::git::list_worktrees(&entry.path)
            .await
            .unwrap_or_default();
        if worktrees.len() > 1 {
            found.push(make(
                CleanupKind::Blocked,
                CleanupReason::HasWorktrees,
                Some((worktrees.len() - 1) as u32),
            ));
            continue;
        }
        if crate::git::ref_exists(&entry.path, "refs/stash").await {
            found.push(make(CleanupKind::Blocked, CleanupReason::HasStashes, None));
            continue;
        }
        if !crate::git::has_remote(&entry.path).await {
            found.push(make(CleanupKind::Blocked, CleanupReason::NoRemote, None));
            continue;
        }
        match crate::git::unpushed_commits(&entry.path).await {
            // Unknown is not zero: a count we could not read must not be read
            // as "nothing to lose".
            None => continue,
            Some(n) if n > 0 => {
                found.push(make(
                    CleanupKind::Blocked,
                    CleanupReason::UnpushedCommits,
                    Some(n),
                ));
                continue;
            }
            _ => {}
        }

        found.push(make(
            CleanupKind::Clone,
            CleanupReason::CloneFullyPushed,
            None,
        ));
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
            // A worktree directly in the root is one checkout, not a group of
            // them — counting its directories would inflate the nudge.
            if is_work_tree(&group.path).await {
                total += 1;
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

/// Whether a live terminal is running in `path`, or anywhere under it.
///
/// A folder with a shell open in it is not a folder to delete, whatever git
/// says about its branch: an agent works by writing files, and between two
/// writes the checkout is momentarily clean.
fn is_busy(path: &str, busy: &[String]) -> bool {
    let path = normalize(path).to_lowercase();
    busy.iter().any(|cwd| {
        let cwd = normalize(cwd).to_lowercase();
        cwd == path || is_inside(&path, &cwd)
    })
}

/// Whether a directory is a git work tree — it holds a `.git`, as a directory
/// (a repository) or as a file (a linked worktree's pointer).
///
/// Cheap on purpose: this runs for every entry in the root, and the answer
/// decides whether the scan may descend. Spawning git per folder to learn it
/// would cost more than the whole rest of the scan.
async fn is_work_tree(path: &str) -> bool {
    tokio::fs::try_exists(format!("{path}/.git"))
        .await
        .unwrap_or(false)
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
    busy: &[String],
) -> Option<CleanupCandidate> {
    let make = |kind, reason, branch, changed_files, repo_path| CleanupCandidate {
        path: entry.path.clone(),
        group: group.to_string(),
        name: entry.name.clone(),
        branch,
        scope: CleanupScope::Worktree,
        kind,
        reason,
        changed_files,
        repo_path,
    };

    // Before anything else: something is running in there. An agent writing
    // files is the one state where "clean right now" says nothing at all.
    if is_busy(&entry.path, busy) {
        return Some(make(
            CleanupKind::Blocked,
            CleanupReason::InUse,
            None,
            None,
            repo.map(str::to_string),
        ));
    }

    let Some(repo) = repo else {
        // No marker at all. That is proof of NOTHING — it is the shape of a
        // folder uxnan never placed — and reading it as "abandoned" is what
        // once offered a live worktree's own directories for deletion.
        return None;
    };
    // A marker naming a repository that is gone: the group really is stranded.
    if !Path::new(repo).is_dir() {
        return Some(make(
            CleanupKind::Orphaned,
            CleanupReason::RepoGone,
            None,
            None,
            None,
        ));
    }

    let listed = crate::git::list_worktrees(repo).await.unwrap_or_default();
    let Some(worktree) = listed
        .iter()
        .find(|e| normalize(&e.path).to_lowercase() == entry.path.to_lowercase())
    else {
        // Inside our root, but this repository does not own it. A work tree
        // belongs to some OTHER repository — never litter. Anything else is a
        // leftover from an interrupted create.
        if is_work_tree(&entry.path).await {
            return None;
        }
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

/// Why a blocked candidate was refused, in one line for the toast. Derived from
/// the reason so a refusal never says "uncommitted changes" about a repository
/// that was actually held back by, say, a stash.
fn blocked_reason(reason: CleanupReason) -> &'static str {
    match reason {
        CleanupReason::UnpushedCommits => "has commits that are on no remote",
        CleanupReason::HasStashes => "has stashes",
        CleanupReason::NoRemote => "has no remote to fetch it from again",
        CleanupReason::HasWorktrees => "still has worktrees",
        CleanupReason::InUse => "has a terminal running in it",
        _ => "has uncommitted changes",
    }
}

/// Re-prove, from scratch, that a cloned repository is safe to delete. `None`
/// when it still is; otherwise the gate it now fails.
///
/// This repeats what [`scan_clones`] already checked, deliberately: the list the
/// user acted on may be minutes old, and this folder is the history. A pull, a
/// commit, or a stash in between has to move the answer.
async fn clone_still_unsafe(path: &str) -> Option<String> {
    if !matches!(crate::git::is_worktree_clean(path).await, Ok(true)) {
        return Some(blocked_reason(CleanupReason::UncommittedChanges).to_string());
    }
    if crate::git::list_worktrees(path)
        .await
        .unwrap_or_default()
        .len()
        > 1
    {
        return Some(blocked_reason(CleanupReason::HasWorktrees).to_string());
    }
    if crate::git::ref_exists(path, "refs/stash").await {
        return Some(blocked_reason(CleanupReason::HasStashes).to_string());
    }
    if !crate::git::has_remote(path).await {
        return Some(blocked_reason(CleanupReason::NoRemote).to_string());
    }
    match crate::git::unpushed_commits(path).await {
        Some(0) => None,
        // Unknown is refused, not allowed: a count we cannot read is not proof
        // that there is nothing to lose.
        _ => Some(blocked_reason(CleanupReason::UnpushedCommits).to_string()),
    }
}

/// Remove the given worktrees, re-deriving every fact rather than trusting the
/// caller's list.
///
/// Each path must (1) sit inside one of `roots`, and (2) still be a candidate
/// the scan classifies as removable. A path that fails either check is refused
/// with a reason instead of being skipped silently — a cleanup that quietly
/// does less than it said is worse than one that explains itself.
pub async fn remove(
    roots: &[String],
    repos_root: &str,
    projects: &[String],
    busy: &[String],
    paths: &[String],
) -> CleanupOutcome {
    let mut outcome = CleanupOutcome::default();
    let mut candidates = scan(roots, projects, busy).await;
    candidates.extend(scan_clones(repos_root, projects, busy).await);

    for path in paths {
        let path = normalize(path);
        // The root this path belongs to is also where its trash folder goes.
        let owning_root = roots
            .iter()
            .find(|root| is_inside(root, &path))
            .cloned()
            .or_else(|| is_inside(repos_root, &path).then(|| normalize(repos_root)));
        let Some(owning_root) = owning_root else {
            outcome.refused.push(CleanupRefusal {
                path,
                reason: "outside the folders uxnan manages".to_string(),
            });
            continue;
        };
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
                reason: blocked_reason(candidate.reason).to_string(),
            });
            continue;
        }
        // A repository re-passes every gate that let it be offered. The scan may
        // be seconds old, and this folder IS the history: "it was fully pushed a
        // minute ago" has to be re-proved, not remembered.
        if candidate.kind == CleanupKind::Clone {
            if let Some(reason) = clone_still_unsafe(&path).await {
                outcome.refused.push(CleanupRefusal { path, reason });
                continue;
            }
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

        match retire(&path, &owning_root).await {
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
    // Removing the last worktree of a project leaves its group holding only the
    // marker — which the next project of that name would read as a live claim.
    if !outcome.removed.is_empty() {
        prune_empty_groups(roots).await;
    }
    outcome
}

/// Move a worktree out of the way, then delete it in the background.
///
/// The rename is what makes "clean up" feel instant: the directory disappears
/// from the list immediately, and the tens of seconds it takes to unlink a
/// `node_modules` happen after the user has moved on. The trash folder lives
/// inside the same root, so the rename is always within one volume.
async fn retire(path: &str, root: &str) -> Result<(), AppError> {
    let trash = Path::new(root).join(TRASH_DIR);
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

/// Delete group folders left holding nothing but their marker.
///
/// Removing the last worktree of a project empties its group, and an empty
/// group is not merely untidy: its `.uxnan-repo` outlives the repository it
/// named, and the next project of the same name reads that stale claim and gets
/// a hash suffix hung on a name that was free. Litter with consequences.
///
/// Only a directory whose sole entry is the marker is removed — one holding
/// anything else is left exactly as found.
pub async fn prune_empty_groups(roots: &[String]) -> u32 {
    let mut pruned = 0;
    for root in roots {
        let root = normalize(root);
        for group in read_dirs(&root).await {
            if group.name == TRASH_DIR {
                continue;
            }
            if !holds_only_marker(&group.path).await {
                continue;
            }
            if tokio::fs::remove_dir_all(&group.path).await.is_ok() {
                pruned += 1;
            }
        }
    }
    pruned
}

/// Whether a directory contains the marker file and nothing else.
async fn holds_only_marker(path: &str) -> bool {
    let Ok(mut reader) = tokio::fs::read_dir(path).await else {
        return false;
    };
    let mut saw_marker = false;
    while let Ok(Some(item)) = reader.next_entry().await {
        if item.file_name().to_string_lossy() == MARKER_FILE {
            saw_marker = true;
        } else {
            return false;
        }
    }
    saw_marker
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
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
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
        let root = crate::worktreeloc::canonical_temp(root_dir.path());
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
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;

        // A leftover from an interrupted create: a directory, but no worktree.
        tokio::fs::create_dir_all(format!("{group}/stray"))
            .await
            .unwrap();

        let found = scan(&[root], std::slice::from_ref(&repo), &[]).await;
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].kind, CleanupKind::Orphaned);
        assert_eq!(found[0].reason, CleanupReason::NotAWorktree);
    }

    #[tokio::test]
    async fn a_worktree_placed_directly_in_the_root_is_never_descended_into() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = crate::worktreeloc::canonical_temp(root_dir.path());
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;

        // Made by hand (or through the dialog's custom location): a worktree
        // sitting straight in the root, with real project directories inside.
        let wt = format!("{root}/remote-ssh");
        crate::git::add_worktree(&repo, "remote-ssh", &wt, Some("main"))
            .await
            .unwrap();
        for dir in ["bridge", "shared", "uxnandesktop"] {
            std::fs::create_dir_all(format!("{wt}/{dir}")).unwrap();
            std::fs::write(format!("{wt}/{dir}/f.txt"), "work\n").unwrap();
        }

        // Treated as a GROUP, its own directories are read as abandoned
        // worktrees and pre-selected — 365 MB of a live checkout, one click
        // from deletion. That is the shape this test exists to hold shut.
        let found = scan(
            std::slice::from_ref(&root),
            std::slice::from_ref(&repo),
            &[],
        )
        .await;
        assert!(
            !found
                .iter()
                .any(|c| ["bridge", "shared", "uxnandesktop"].contains(&c.name.as_str())),
            "descended into a live worktree: {found:?}"
        );
        assert!(
            found.iter().all(|c| c.kind != CleanupKind::Orphaned),
            "a live worktree's contents were called orphaned: {found:?}"
        );
    }

    #[tokio::test]
    async fn a_worktree_with_a_live_terminal_is_never_offered() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;

        // A merged branch: by every other rule, finished work ready to go.
        let wt = format!("{group}/done");
        crate::git::add_worktree(&repo, "done", &wt, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{wt}/f.txt"), "work\n").unwrap();
        run_git(&wt, &["add", "-A"]).await;
        run_git(&wt, &["commit", "-m", "work"]).await;
        run_git(&repo, &["merge", "--no-ff", "-m", "merge", "done"]).await;

        let idle = scan(
            std::slice::from_ref(&root),
            std::slice::from_ref(&repo),
            &[],
        )
        .await;
        assert_eq!(idle[0].kind, CleanupKind::Finished);

        // Now an agent is working in it. Clean-right-now says nothing: it is
        // clean between two writes.
        let busy = [wt.clone()];
        let working = scan(
            std::slice::from_ref(&root),
            std::slice::from_ref(&repo),
            &busy,
        )
        .await;
        assert_eq!(working[0].kind, CleanupKind::Blocked);
        assert_eq!(working[0].reason, CleanupReason::InUse);

        // A terminal open in a SUBFOLDER counts too, and removal refuses.
        let nested = [format!("{wt}/src")];
        let outcome = remove(
            std::slice::from_ref(&root),
            "",
            std::slice::from_ref(&repo),
            &nested,
            std::slice::from_ref(&wt),
        )
        .await;
        assert!(outcome.removed.is_empty());
        assert!(Path::new(&wt).is_dir(), "the worktree must survive");
    }

    #[tokio::test]
    async fn a_folder_with_no_marker_is_left_entirely_alone() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = crate::worktreeloc::canonical_temp(root_dir.path());

        // Something the app never placed. Absence of a marker proves nothing
        // about it, so it is reported as nothing at all.
        std::fs::create_dir_all(format!("{root}/mystery/inside")).unwrap();

        assert!(scan(std::slice::from_ref(&root), &[], &[]).await.is_empty());
    }

    #[tokio::test]
    async fn a_group_whose_repository_vanished_is_orphaned() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;
        tokio::fs::create_dir_all(format!("{group}/feat"))
            .await
            .unwrap();
        drop(repo_dir); // the repository is deleted from disk

        let found = scan(&[root], std::slice::from_ref(&repo), &[]).await;
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].reason, CleanupReason::RepoGone);
    }

    #[tokio::test]
    async fn a_clean_merged_worktree_is_offered_and_a_dirty_one_is_blocked() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
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

        let found = scan(&[root], std::slice::from_ref(&repo), &[]).await;
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
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;

        // Created this morning, nothing done in it, never pushed: not finished,
        // and offering it would be offering to delete work that never happened.
        crate::git::add_worktree(&repo, "fresh", &format!("{group}/fresh"), Some("main"))
            .await
            .unwrap();

        assert!(scan(&[root], std::slice::from_ref(&repo), &[])
            .await
            .is_empty());
    }

    #[tokio::test]
    async fn a_worktree_of_a_closed_project_is_offered_but_not_pre_selected() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;

        // Created and never touched — exactly what the sidebar would call
        // unfinished, so none of the other rules sees it.
        crate::git::add_worktree(&repo, "fresh", &format!("{group}/fresh"), Some("main"))
            .await
            .unwrap();
        assert!(scan(
            std::slice::from_ref(&root),
            std::slice::from_ref(&repo),
            &[]
        )
        .await
        .is_empty());

        // Remove the project from the app (which touches nothing on disk) and
        // it becomes the one thing that DOES say this checkout is disposable.
        let found = scan(std::slice::from_ref(&root), &[], &[]).await;
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].kind, CleanupKind::Unregistered);
        assert_eq!(found[0].reason, CleanupReason::ProjectRemoved);
        assert_eq!(found[0].branch.as_deref(), Some("fresh"));
    }

    #[tokio::test]
    async fn a_closed_project_with_unsaved_work_is_still_blocked() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;
        let dirty = format!("{group}/wip");
        crate::git::add_worktree(&repo, "wip", &dirty, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{dirty}/scratch.txt"), "unsaved\n").unwrap();

        // Closing the project must not downgrade the protection.
        let found = scan(std::slice::from_ref(&root), &[], &[]).await;
        assert_eq!(found[0].kind, CleanupKind::Blocked);
        let outcome = remove(
            std::slice::from_ref(&root),
            "",
            &[],
            &[],
            std::slice::from_ref(&dirty),
        )
        .await;
        assert!(outcome.removed.is_empty());
        assert!(Path::new(&dirty).is_dir(), "the worktree must survive");
    }

    /// A repository in the managed `repos` folder, cloned from a bare "remote"
    /// so the pushed/unpushed distinction is real rather than simulated.
    async fn cloned_repo(name: &str) -> (tempfile::TempDir, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let base = crate::worktreeloc::canonical_temp(dir.path());
        let origin = format!("{base}/origin.git");
        let source = format!("{base}/source");
        std::fs::create_dir_all(&source).unwrap();
        init_repo(&source).await;
        // `-b main`: without it the bare repo's HEAD points at this machine's
        // `init.defaultBranch`, the clone checks out a branch that does not
        // exist, and every test here would run against an unborn HEAD — passing
        // for the wrong reason.
        run_git(&base, &["init", "--bare", "-b", "main", "origin.git"]).await;
        run_git(&source, &["remote", "add", "origin", &origin]).await;
        run_git(&source, &["push", "-u", "origin", "main"]).await;

        let repos_root = format!("{base}/repos");
        std::fs::create_dir_all(&repos_root).unwrap();
        let clone = format!("{repos_root}/{name}");
        run_git(&base, &["clone", &origin, &clone]).await;
        run_git(&clone, &["config", "user.email", "test@uxnan.dev"]).await;
        run_git(&clone, &["config", "user.name", "Uxnan Test"]).await;
        run_git(&clone, &["config", "commit.gpgsign", "false"]).await;
        (dir, repos_root, clone)
    }

    #[tokio::test]
    async fn a_fully_pushed_clone_that_is_no_longer_a_project_is_offered() {
        let (_dir, repos_root, clone) = cloned_repo("sample").await;

        // While it is a project, it is in use and never listed.
        assert!(scan_clones(&repos_root, std::slice::from_ref(&clone), &[])
            .await
            .is_empty());

        let found = scan_clones(&repos_root, &[], &[]).await;
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].kind, CleanupKind::Clone);
        assert_eq!(found[0].reason, CleanupReason::CloneFullyPushed);
    }

    #[tokio::test]
    async fn a_clone_with_commits_on_no_remote_is_blocked_and_survives() {
        let (_dir, repos_root, clone) = cloned_repo("sample").await;
        std::fs::write(format!("{clone}/local.txt"), "only here\n").unwrap();
        run_git(&clone, &["add", "-A"]).await;
        run_git(&clone, &["commit", "-m", "never pushed"]).await;

        let found = scan_clones(&repos_root, &[], &[]).await;
        assert_eq!(found[0].kind, CleanupKind::Blocked);
        assert_eq!(found[0].reason, CleanupReason::UnpushedCommits);
        assert_eq!(found[0].changed_files, Some(1));

        // And the gate holds through the removal path, not just the listing.
        let outcome = remove(&[], &repos_root, &[], &[], std::slice::from_ref(&clone)).await;
        assert!(outcome.removed.is_empty());
        assert_eq!(outcome.refused.len(), 1);
        assert!(Path::new(&clone).is_dir(), "the repository must survive");
    }

    #[tokio::test]
    async fn a_clone_with_a_stash_is_blocked() {
        let (_dir, repos_root, clone) = cloned_repo("sample").await;
        std::fs::write(format!("{clone}/README.md"), "changed\n").unwrap();
        run_git(&clone, &["stash"]).await;

        let found = scan_clones(&repos_root, &[], &[]).await;
        assert_eq!(found[0].kind, CleanupKind::Blocked);
        assert_eq!(found[0].reason, CleanupReason::HasStashes);
    }

    #[tokio::test]
    async fn a_clone_with_no_remote_is_blocked() {
        let (_dir, repos_root, clone) = cloned_repo("sample").await;
        run_git(&clone, &["remote", "remove", "origin"]).await;

        let found = scan_clones(&repos_root, &[], &[]).await;
        assert_eq!(found[0].kind, CleanupKind::Blocked);
        assert_eq!(found[0].reason, CleanupReason::NoRemote);
    }

    #[tokio::test]
    async fn a_clone_whose_worktrees_are_still_out_is_blocked() {
        let (_dir, repos_root, clone) = cloned_repo("sample").await;
        let wt = format!("{repos_root}/../wt");
        crate::git::add_worktree(&clone, "side", &wt, Some("main"))
            .await
            .unwrap();

        let found = scan_clones(&repos_root, &[], &[]).await;
        assert_eq!(found[0].kind, CleanupKind::Blocked);
        assert_eq!(found[0].reason, CleanupReason::HasWorktrees);
    }

    #[tokio::test]
    async fn removing_a_fully_pushed_clone_takes_it() {
        let (_dir, repos_root, clone) = cloned_repo("sample").await;

        let outcome = remove(&[], &repos_root, &[], &[], std::slice::from_ref(&clone)).await;
        assert_eq!(outcome.removed, vec![clone.clone()]);
        assert!(!Path::new(&clone).exists());
    }

    #[tokio::test]
    async fn removal_refuses_a_path_outside_the_managed_root() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, _group) = managed_root(&repo).await;

        // The repository itself: inside no managed root, and the exact thing a
        // stale or forged list must never be able to delete.
        let outcome = remove(
            &[root],
            "",
            &[],
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
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;
        let dirty = format!("{group}/wip");
        crate::git::add_worktree(&repo, "wip", &dirty, Some("main"))
            .await
            .unwrap();
        std::fs::write(format!("{dirty}/scratch.txt"), "unsaved\n").unwrap();

        let outcome = remove(
            &[root],
            "",
            &[],
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
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
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
            "",
            &[],
            std::slice::from_ref(&repo),
            std::slice::from_ref(&stray),
        )
        .await;
        assert_eq!(outcome.removed, vec![stray.clone()]);
        assert!(!Path::new(&stray).exists());
        // The group went with it: nothing was left in it but the marker, and a
        // marker with no worktrees under it is what the next project of this
        // name would misread as a live claim.
        assert!(!Path::new(&group).exists());
        // The repository itself is untouched.
        assert!(Path::new(&repo).is_dir());
    }

    #[tokio::test]
    async fn cleaning_the_last_worktree_takes_the_empty_group_with_it() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = crate::worktreeloc::canonical_temp(repo_dir.path());
        init_repo(&repo).await;
        let (_root_dir, root, group) = managed_root(&repo).await;
        let stray = format!("{group}/stray");
        tokio::fs::create_dir_all(&stray).await.unwrap();

        remove(
            std::slice::from_ref(&root),
            "",
            std::slice::from_ref(&repo),
            &[],
            std::slice::from_ref(&stray),
        )
        .await;

        // The group is gone, marker and all: left behind, its stale marker is
        // what the next project of this name would read as a live claim.
        assert!(!Path::new(&group).exists(), "the empty group must go");
    }

    #[tokio::test]
    async fn pruning_leaves_a_group_that_holds_anything_else() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = crate::worktreeloc::canonical_temp(root_dir.path());
        let empty = format!("{root}/empty");
        let occupied = format!("{root}/occupied");
        tokio::fs::create_dir_all(&empty).await.unwrap();
        tokio::fs::create_dir_all(format!("{occupied}/a-worktree"))
            .await
            .unwrap();
        for dir in [&empty, &occupied] {
            tokio::fs::write(format!("{dir}/{MARKER_FILE}"), "C:/repo")
                .await
                .unwrap();
        }
        // A group holding something the app did not put there is untouchable.
        let with_file = format!("{root}/with-file");
        tokio::fs::create_dir_all(&with_file).await.unwrap();
        tokio::fs::write(format!("{with_file}/{MARKER_FILE}"), "C:/repo")
            .await
            .unwrap();
        tokio::fs::write(format!("{with_file}/notes.txt"), "mine")
            .await
            .unwrap();

        assert_eq!(prune_empty_groups(std::slice::from_ref(&root)).await, 1);
        assert!(!Path::new(&empty).exists());
        assert!(Path::new(&occupied).is_dir());
        assert!(Path::new(&with_file).is_dir());
    }

    #[tokio::test]
    async fn the_sweep_only_takes_folders_this_module_named() {
        let root_dir = tempfile::tempdir().unwrap();
        let root = crate::worktreeloc::canonical_temp(root_dir.path());
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
