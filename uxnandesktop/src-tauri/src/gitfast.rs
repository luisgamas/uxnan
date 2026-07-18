//! Fast git status/diff via `git2` (libgit2) — the high-frequency path used by
//! the 3 s status watcher and the review panel, avoiding a `git` subprocess per
//! poll. These are **synchronous** (libgit2 blocks); call them from
//! `spawn_blocking`. `git.rs` wraps each with a CLI fallback, so a repo `git2`
//! can't open still works (spec `02c` §3.1: git2 + CLI fallback).

use std::cell::RefCell;
use std::collections::HashMap;

use git2::{Branch, DiffFormat, DiffOptions, Oid, Repository, Sort, Status, StatusOptions};

use crate::git::{CommitInfo, FileChange, FileNumstat, WorktreeStatus};

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

/// Best-effort: which of `paths` (absolute, native or forward-slash) git
/// ignores, in the repository that contains `dir`. Returns one bool per input
/// path, in order — all `false` when `dir` isn't inside a git repo, so the file
/// tree keeps working outside a repository. Mirrors `git check-ignore`: tracked
/// files are never reported ignored even when a rule matches. Used to dim
/// ignored entries in the file-tree tab.
pub fn ignored_flags(dir: &str, paths: &[String]) -> Vec<bool> {
    let mut out = vec![false; paths.len()];
    let Ok(repo) = Repository::discover(dir) else {
        return out;
    };
    // `is_path_ignored` wants a path relative to the workdir; `strip_prefix`
    // compares by component, so mixed `/` vs `\` separators still line up.
    let workdir = repo.workdir().map(std::path::Path::to_path_buf);
    for (i, p) in paths.iter().enumerate() {
        let abs = std::path::PathBuf::from(p);
        let rel = match &workdir {
            Some(w) => abs
                .strip_prefix(w)
                .map(std::path::Path::to_path_buf)
                .unwrap_or(abs),
            None => abs,
        };
        out[i] = repo.is_path_ignored(&rel).unwrap_or(false);
    }
    out
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

/// One-scan combination of [`status_files`] + [`worktree_status`]: the file
/// list, plus a summary whose `dirty` is the list's length (same `IGNORED`
/// filter) and whose ahead/behind comes from the cheap graph walk — so the
/// 3 s watcher pays for one working-tree scan, not two. Because both parts read
/// from the same `statuses()` walk, `summary.dirty == files.len()` holds by
/// construction.
pub fn status_with_summary(path: &str) -> Result<(Vec<FileChange>, WorktreeStatus), git2::Error> {
    let repo = Repository::open(path)?;
    let mut opts = status_options();
    let statuses = repo.statuses(Some(&mut opts))?;
    let mut files = Vec::new();
    for entry in statuses.iter() {
        let s = entry.status();
        if s.contains(Status::IGNORED) {
            continue;
        }
        let Some(p) = entry.path() else { continue };
        let (index, worktree) = map_status(s);
        files.push(FileChange {
            path: p.replace('\\', "/"),
            index,
            worktree,
        });
    }
    let (ahead, behind) = ahead_behind(&repo);
    let summary = WorktreeStatus {
        dirty: files.len() as u32,
        ahead,
        behind,
    };
    Ok((files, summary))
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

/// Map each commit oid to its ref decorations (`HEAD`, branch names, `tag: …`),
/// resolving annotated tags to the commit they point at (so a tag decorates the
/// right node). Mirrors `git log --decorate`'s `%D`.
fn ref_decorations(repo: &Repository) -> HashMap<Oid, Vec<String>> {
    let mut decs: HashMap<Oid, Vec<String>> = HashMap::new();
    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            // Peel through annotated tags / symbolic refs to the commit.
            let Ok(commit) = r.peel_to_commit() else {
                continue;
            };
            let Some(name) = r.shorthand() else { continue };
            if name == "HEAD" {
                continue; // added explicitly below, first
            }
            let label = if r.is_tag() {
                format!("tag: {name}")
            } else {
                name.to_string()
            };
            decs.entry(commit.id()).or_default().push(label);
        }
    }
    // HEAD first, so the frontend can show it leading.
    if let Ok(head) = repo.head() {
        if let Ok(commit) = head.peel_to_commit() {
            decs.entry(commit.id())
                .or_default()
                .insert(0, "HEAD".to_string());
        }
    }
    decs
}

/// Commit history (newest first, topological), `limit` commits from `skip`.
/// An unborn `HEAD` (no commits yet) yields an empty list, not an error.
pub fn log(path: &str, limit: usize, skip: usize) -> Result<Vec<CommitInfo>, git2::Error> {
    let repo = Repository::open(path)?;
    let decs = ref_decorations(&repo);
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    if walk.push_head().is_err() {
        return Ok(Vec::new()); // no commits yet
    }
    let mut out = Vec::with_capacity(limit);
    for oid in walk.skip(skip) {
        if out.len() >= limit {
            break;
        }
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let message = commit.message().unwrap_or("");
        let mut parts = message.splitn(2, '\n');
        let subject = parts.next().unwrap_or("").trim_end().to_string();
        let body = parts.next().unwrap_or("").trim().to_string();
        let author = commit.author();
        out.push(CommitInfo {
            hash: oid.to_string(),
            short_hash: short_hash(&oid),
            parents: commit.parent_ids().map(|p| p.to_string()).collect(),
            subject,
            body,
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            refs: decs.get(&oid).cloned().unwrap_or_default(),
        });
    }
    Ok(out)
}

/// Git's default 7+ char abbreviated hash (first 7 chars; git lengthens only on
/// collision, rare enough that 7 matches the CLI for almost every repo).
fn short_hash(oid: &Oid) -> String {
    oid.to_string().chars().take(7).collect()
}

/// Unified diff a commit introduced vs its first parent (root commit → vs empty).
pub fn show(path: &str, hash: &str) -> Result<String, git2::Error> {
    let repo = Repository::open(path)?;
    let oid = Oid::from_str(hash)?;
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    diff_to_string(&diff)
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
    fn ignored_flags_matches_gitignore_for_files_and_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        Repository::init(dir).unwrap();
        std::fs::write(dir.join(".gitignore"), "ignored.txt\nbuild/\n").unwrap();
        std::fs::write(dir.join("ignored.txt"), "x").unwrap();
        std::fs::write(dir.join("kept.txt"), "x").unwrap();
        std::fs::create_dir(dir.join("build")).unwrap();

        // Forward-slash absolute paths, exactly as `list_dir` hands them over.
        let paths: Vec<String> = ["ignored.txt", "kept.txt", "build", ".gitignore"]
            .iter()
            .map(|n| dir.join(n).to_string_lossy().replace('\\', "/"))
            .collect();
        let flags = ignored_flags(&dir.to_string_lossy(), &paths);
        // ignored.txt + build/ matched; kept.txt + .gitignore are not ignored.
        assert_eq!(flags, vec![true, false, true, false]);
    }

    #[test]
    fn ignored_flags_all_false_outside_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp
            .path()
            .join("a.txt")
            .to_string_lossy()
            .replace('\\', "/");
        // No repo at/above the temp dir → every entry un-flagged, no panic.
        assert_eq!(
            ignored_flags(&tmp.path().to_string_lossy(), &[p]),
            vec![false]
        );
    }

    #[test]
    fn status_clean_repo_has_zero_dirty() {
        let tmp = tempfile::tempdir().unwrap();
        Repository::init(tmp.path()).unwrap();
        let st = worktree_status(&tmp.path().to_string_lossy()).unwrap();
        assert_eq!(st.dirty, 0);
        assert_eq!((st.ahead, st.behind), (0, 0));
    }

    /// The one-scan `status_with_summary` must return exactly what the two
    /// separate `status_files` + `worktree_status` scans do — this pins the
    /// "combined == parts" contract so the watcher's single scan can't silently
    /// drift from the on-demand path. Also asserts `dirty == files.len()`, the
    /// invariant that makes dropping the second scan sound.
    #[test]
    fn status_with_summary_matches_parts() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@t").unwrap();

        // One committed file, then a tracked modification + an untracked file so
        // the working tree is genuinely dirty when we scan.
        commit_file(&repo, dir, "a.txt", "one\ntwo\n", "init");
        std::fs::write(dir.join("a.txt"), "one\nTWO\nthree\n").unwrap();
        std::fs::write(dir.join("b.txt"), "new\n").unwrap();

        let path = dir.to_string_lossy().to_string();
        let (files, summary) = status_with_summary(&path).unwrap();
        let parts_files = status_files(&path).unwrap();
        let parts_status = worktree_status(&path).unwrap();

        // The file list is identical to the standalone scan's.
        assert_eq!(files, parts_files);
        // dirty equals the list length (same IGNORED filter) — the invariant.
        assert_eq!(summary.dirty as usize, files.len());
        assert_eq!(summary.dirty, parts_status.dirty);
        // ahead/behind matches the cheap graph walk of the standalone summary.
        assert_eq!(
            (summary.ahead, summary.behind),
            (parts_status.ahead, parts_status.behind)
        );
    }

    /// Commit a file to `repo`, returning the new commit oid. Stages the whole
    /// working tree onto the current `HEAD`.
    fn commit_file(repo: &Repository, dir: &std::path::Path, name: &str, content: &str, msg: &str) {
        std::fs::write(dir.join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        let parents = match repo.head().ok().and_then(|h| h.peel_to_commit().ok()) {
            Some(c) => vec![c],
            None => vec![],
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
            .unwrap();
    }

    #[test]
    fn log_lists_commits_newest_first_with_parents_and_show() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@t").unwrap();

        // Unborn HEAD → empty log (not an error).
        let path = dir.to_string_lossy().to_string();
        assert!(log(&path, 50, 0).unwrap().is_empty());

        commit_file(&repo, dir, "a.txt", "one\n", "first");
        commit_file(&repo, dir, "a.txt", "one\ntwo\n", "second");

        let commits = log(&path, 50, 0).unwrap();
        assert_eq!(commits.len(), 2);
        // Newest first.
        assert_eq!(commits[0].subject, "second");
        assert_eq!(commits[1].subject, "first");
        // The second commit's parent is the first; the first is a root (no parent).
        assert_eq!(commits[0].parents, vec![commits[1].hash.clone()]);
        assert!(commits[1].parents.is_empty());
        assert_eq!(commits[0].author_name, "Tester");
        // HEAD decorates the tip.
        assert!(commits[0].refs.iter().any(|r| r == "HEAD"));

        // Pagination: skip the newest, get one.
        let page = log(&path, 1, 1).unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].subject, "first");

        // show() of the tip is a real unified diff adding "two".
        let diff = show(&path, &commits[0].hash).unwrap();
        assert!(diff.contains("@@") && diff.contains("+two"));
    }
}
