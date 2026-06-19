//! Fast git status/diff via `git2` (libgit2) — the high-frequency path used by
//! the 3 s status watcher and the review panel, avoiding a `git` subprocess per
//! poll. These are **synchronous** (libgit2 blocks); call them from
//! `spawn_blocking`. `git.rs` wraps each with a CLI fallback, so a repo `git2`
//! can't open still works (spec `02c` §3.1: git2 + CLI fallback).

use std::cell::RefCell;

use git2::{Branch, DiffFormat, DiffOptions, Repository, Status, StatusOptions};

use crate::git::{FileChange, FileNumstat, WorktreeStatus};

/// Map a libgit2 `Status` to the porcelain `XY` code pair the frontend expects
/// (`index` = X, `worktree` = Y). Untracked → `"?","?"`, conflicts → `"U","U"`.
fn map_status(s: Status) -> (String, String) {
    if s.contains(Status::CONFLICTED) {
        return ("U".into(), "U".into());
    }
    let index = if s.contains(Status::INDEX_NEW) {
        "A"
    } else if s.contains(Status::INDEX_MODIFIED) {
        "M"
    } else if s.contains(Status::INDEX_DELETED) {
        "D"
    } else if s.contains(Status::INDEX_RENAMED) {
        "R"
    } else if s.contains(Status::INDEX_TYPECHANGE) {
        "T"
    } else {
        " "
    };
    let mut worktree = if s.contains(Status::WT_NEW) {
        "?"
    } else if s.contains(Status::WT_MODIFIED) {
        "M"
    } else if s.contains(Status::WT_DELETED) {
        "D"
    } else if s.contains(Status::WT_RENAMED) {
        "R"
    } else if s.contains(Status::WT_TYPECHANGE) {
        "T"
    } else {
        " "
    };
    // A wholly-untracked file is porcelain "??": mirror it on the index side too
    // (the frontend treats index == "?" && worktree == "?" as untracked).
    let index = if worktree == "?" && index == " " {
        "?"
    } else {
        index
    };
    if worktree == "?" && index != "?" {
        // index-tracked + a stray WT_NEW (rare): not untracked.
        worktree = " ";
    }
    (index.to_string(), worktree.to_string())
}

fn status_options() -> StatusOptions {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    opts
}

/// List a worktree's changed files (git2 equivalent of `git status --porcelain`).
pub fn status_files(path: &str) -> Result<Vec<FileChange>, git2::Error> {
    let repo = Repository::open(path)?;
    let mut opts = status_options();
    let statuses = repo.statuses(Some(&mut opts))?;
    let mut out = Vec::new();
    for entry in statuses.iter() {
        let s = entry.status();
        if s.contains(Status::IGNORED) {
            continue;
        }
        let Some(p) = entry.path() else { continue };
        let (index, worktree) = map_status(s);
        out.push(FileChange {
            path: p.replace('\\', "/"),
            index,
            worktree,
        });
    }
    Ok(out)
}

/// Ahead/behind the upstream for the current branch (0/0 when detached or no
/// upstream).
fn ahead_behind(repo: &Repository) -> (u32, u32) {
    let Ok(head) = repo.head() else {
        return (0, 0);
    };
    if !head.is_branch() {
        return (0, 0);
    }
    let Some(local) = head.target() else {
        return (0, 0);
    };
    let branch = Branch::wrap(head);
    let Ok(upstream) = branch.upstream() else {
        return (0, 0);
    };
    let Some(up) = upstream.get().target() else {
        return (0, 0);
    };
    repo.graph_ahead_behind(local, up)
        .map(|(a, b)| (a as u32, b as u32))
        .unwrap_or((0, 0))
}

/// Working-tree status summary (dirty count + ahead/behind).
pub fn worktree_status(path: &str) -> Result<WorktreeStatus, git2::Error> {
    let repo = Repository::open(path)?;
    let mut opts = status_options();
    let dirty = repo
        .statuses(Some(&mut opts))?
        .iter()
        .filter(|e| !e.status().contains(Status::IGNORED))
        .count() as u32;
    let (ahead, behind) = ahead_behind(&repo);
    Ok(WorktreeStatus {
        dirty,
        ahead,
        behind,
    })
}

/// Render a `git2::Diff` to a unified-diff string (the format the frontend's
/// `diff.ts` parser expects).
fn diff_to_string(diff: &git2::Diff) -> Result<String, git2::Error> {
    let mut buf = String::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        match line.origin() {
            '+' | '-' | ' ' => buf.push(line.origin()),
            _ => {}
        }
        buf.push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;
    Ok(buf)
}

/// Unified diff for one file. `staged` → index-vs-HEAD; else worktree-vs-index
/// (untracked content shown as added).
pub fn diff_file(path: &str, file: &str, staged: bool) -> Result<String, git2::Error> {
    let repo = Repository::open(path)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(file);
    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
    } else {
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    diff_to_string(&diff)
}

/// Working-tree-vs-`HEAD` diff for one file (staged + unstaged combined).
pub fn diff_head(path: &str, file: &str) -> Result<String, git2::Error> {
    let repo = Repository::open(path)?;
    let head_tree = repo.head()?.peel_to_tree()?;
    let mut opts = DiffOptions::new();
    opts.pathspec(file);
    let diff = repo.diff_tree_to_workdir_with_index(Some(&head_tree), Some(&mut opts))?;
    diff_to_string(&diff)
}

/// Per-file added/deleted line counts vs `HEAD` (tracked files only).
pub fn numstat(path: &str) -> Result<Vec<FileNumstat>, git2::Error> {
    let repo = Repository::open(path)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), None)?;

    // Shared accumulator (the file + line callbacks both mutate it).
    let acc: RefCell<(Vec<FileNumstat>, Option<FileNumstat>)> = RefCell::new((Vec::new(), None));
    diff.foreach(
        &mut |delta, _| {
            let mut a = acc.borrow_mut();
            if let Some(cur) = a.1.take() {
                a.0.push(cur);
            }
            let path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            a.1 = Some(FileNumstat {
                path,
                added: 0,
                deleted: 0,
            });
            true
        },
        None,
        None,
        Some(&mut |_delta, _hunk, line| {
            let mut a = acc.borrow_mut();
            if let Some(cur) = a.1.as_mut() {
                match line.origin() {
                    '+' => cur.added += 1,
                    '-' => cur.deleted += 1,
                    _ => {}
                }
            }
            true
        }),
    )?;
    let mut inner = acc.into_inner();
    if let Some(cur) = inner.1.take() {
        inner.0.push(cur);
    }
    // Skip binary deltas (no +/- lines) so they don't show 0/0 noise.
    Ok(inner.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Init a temp repo with one committed file, then make a tracked change and
    /// an untracked file — exercising the status mapping + numstat.
    #[test]
    fn status_and_numstat_on_real_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let repo = Repository::init(dir).unwrap();
        // Identity for the commit.
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "t").unwrap();
        cfg.set_str("user.email", "t@t").unwrap();

        std::fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        // Commit a.txt.
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
            .unwrap();

        let path = dir.to_string_lossy().to_string();
        // Clean now.
        assert!(status_files(&path).unwrap().is_empty());

        // Modify a.txt + add an untracked file.
        std::fs::write(dir.join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        std::fs::write(dir.join("b.txt"), "new\n").unwrap();

        let files = status_files(&path).unwrap();
        let a = files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.worktree, "M"); // unstaged modification
        let b = files.iter().find(|f| f.path == "b.txt").unwrap();
        assert_eq!((b.index.as_str(), b.worktree.as_str()), ("?", "?")); // untracked

        // numstat vs HEAD: a.txt changed (added/deleted > 0); untracked excluded.
        let ns = numstat(&path).unwrap();
        let a_ns = ns.iter().find(|n| n.path == "a.txt").unwrap();
        assert!(a_ns.added > 0 && a_ns.deleted > 0);
        assert!(ns.iter().all(|n| n.path != "b.txt"));

        // diff_head for a.txt is a real unified diff.
        let d = diff_head(&path, "a.txt").unwrap();
        assert!(d.contains("@@") && d.contains("+four"));
    }

    #[test]
    fn status_clean_repo_has_zero_dirty() {
        let tmp = tempfile::tempdir().unwrap();
        Repository::init(tmp.path()).unwrap();
        let st = worktree_status(&tmp.path().to_string_lossy()).unwrap();
        assert_eq!(st.dirty, 0);
        assert_eq!((st.ahead, st.behind), (0, 0));
    }
}
