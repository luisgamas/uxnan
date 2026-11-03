//! Watching a repository's own git directory, so what lives there — its
//! worktrees, every branch's tip, the upstreams, each worktree's `HEAD` and
//! index — is known the moment it moves instead of on the next poll.
//!
//! What is watched is the repository's *common* directory (the main worktree's
//! `.git`, shared by every linked worktree): `HEAD`, `index`, `packed-refs`,
//! `refs/`, and `worktrees/<name>/{HEAD,index}`. A commit, a stage, a checkout,
//! a push or fetch that moves an upstream, and a `git worktree add` / `remove`
//! made by anyone all land there. The object store and the reflogs are churn
//! that names nothing a row shows, so their paths never count as a change.
//!
//! The cost is held to the git directory's own folders, never the working
//! tree: no file is indexed (the engine's [`watch::debounced`]), and on Linux
//! inotify's per-directory watches are the `.git` folders only.
//!
//! A project that is a plain folder is watched too, for the one change that
//! matters about it: `.git` appearing (a `git init`, a clone into it) — one
//! non-recursive watch on the folder itself, so a plain folder is not asked
//! "are you a repository yet?" on a timer.

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::DebounceEventResult;

use crate::watch::{self, Watch};

/// The repository's common git directory: where its refs, its index and its
/// linked worktrees' records live. `None` when `path` is not a worktree root.
pub fn common_dir(path: &Path) -> Option<PathBuf> {
    let repo = git2::Repository::open(path).ok()?;
    if repo.is_bare() {
        return None;
    }
    Some(repo.commondir().to_path_buf())
}

/// What a project's watch follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A worktree root: its common git directory is watched.
    Repository,
    /// A plain folder: watched for `.git` appearing in it.
    Folder,
}

/// Which watch `path` takes, or `None` when there is no folder there.
pub fn kind_of(path: &Path) -> Option<Kind> {
    if common_dir(path).is_some() {
        Some(Kind::Repository)
    } else if path.is_dir() {
        Some(Kind::Folder)
    } else {
        None
    }
}

/// Watch `path` the way its [`Kind`] calls for, answering which it took.
pub fn start_any<F>(path: &Path, report: F) -> notify::Result<(Kind, Watch)>
where
    F: Fn() + Send + 'static,
{
    match kind_of(path) {
        Some(Kind::Repository) => start(path, report).map(|w| (Kind::Repository, w)),
        Some(Kind::Folder) => start_folder(path, report).map(|w| (Kind::Folder, w)),
        None => Err(notify::Error::generic("no folder there")),
    }
}

/// Watch a plain folder's own entries (not recursive), calling `report` when
/// its `.git` is created or removed — the folder became a repository or
/// stopped being one.
pub fn start_folder<F>(folder: &Path, report: F) -> notify::Result<Watch>
where
    F: Fn() + Send + 'static,
{
    let mut debouncer = watch::debounced(
        Duration::from_millis(300),
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let git = events.iter().any(|e| {
                e.paths
                    .iter()
                    .any(|p| p.file_name().is_some_and(|n| n == ".git"))
            });
            if git {
                report();
            }
        },
    )?;
    debouncer.watch(folder, RecursiveMode::NonRecursive)?;
    Ok(debouncer)
}

/// Whether a path under the common directory names something a worktree row
/// shows. Objects, reflogs and lock files are how git writes, not what it wrote.
fn counts(common: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(common) else {
        return false;
    };
    let mut parts = relative.components();
    let first = match parts.next() {
        Some(Component::Normal(name)) => name,
        // The common directory itself (created or replaced).
        None => return true,
        Some(_) => return false,
    };
    if first == "objects" || first == "logs" {
        return false;
    }
    // `worktrees/<name>/logs/…` is a linked worktree's reflog.
    if first == "worktrees"
        && relative
            .components()
            .nth(2)
            .is_some_and(|c| c.as_os_str() == "logs")
    {
        return false;
    }
    !path.extension().is_some_and(|ext| ext == "lock")
}

/// Watch the git directory of the repository at `repo`, calling `report` once
/// per debounced batch that moved something a row shows. Fails when `repo` is
/// not a worktree root or the platform refuses the watch — the caller keeps
/// asking git on a timer for that repository.
pub fn start<F>(repo: &Path, report: F) -> notify::Result<Watch>
where
    F: Fn() + Send + 'static,
{
    let common =
        common_dir(repo).ok_or_else(|| notify::Error::generic("not the root of a git worktree"))?;
    let resolved = std::fs::canonicalize(&common).unwrap_or_else(|_| common.clone());
    let forms = [common.clone(), resolved];
    let mut debouncer = watch::debounced(
        Duration::from_millis(300),
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let moved = events.iter().any(|e| {
                e.paths
                    .iter()
                    .any(|p| forms.iter().any(|root| counts(root, p)))
            });
            if moved {
                report();
            }
        },
    )?;
    debouncer.watch(&common, RecursiveMode::Recursive)?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::mpsc;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = PathBuf::from(crate::worktreeloc::canonical_temp(dir.path()));
        git(&path, &["init", "-b", "main"]);
        git(&path, &["config", "user.email", "test@uxnan.dev"]);
        git(&path, &["config", "user.name", "Uxnan Test"]);
        git(&path, &["config", "commit.gpgsign", "false"]);
        std::fs::write(path.join("a.md"), "a").unwrap();
        git(&path, &["add", "-A"]);
        git(&path, &["commit", "-m", "initial"]);
        (dir, path)
    }

    /// Start a real watch and give the platform's watcher a moment to settle.
    fn watching(path: &Path) -> (Watch, mpsc::Receiver<()>) {
        let (tx, rx) = mpsc::channel();
        let w = start(path, move || {
            let _ = tx.send(());
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(400));
        while rx.try_recv().is_ok() {}
        (w, rx)
    }

    fn reported(rx: &mpsc::Receiver<()>) -> bool {
        rx.recv_timeout(Duration::from_secs(5)).is_ok()
    }

    #[test]
    fn only_what_a_row_shows_counts() {
        let c = Path::new("/r/.git");
        assert!(counts(c, Path::new("/r/.git/HEAD")));
        assert!(counts(c, Path::new("/r/.git/index")));
        assert!(counts(c, Path::new("/r/.git/packed-refs")));
        assert!(counts(c, Path::new("/r/.git/refs/heads/feat/x")));
        assert!(counts(c, Path::new("/r/.git/refs/remotes/origin/main")));
        assert!(counts(c, Path::new("/r/.git/worktrees/x")));
        assert!(counts(c, Path::new("/r/.git/worktrees/x/HEAD")));
        assert!(counts(c, Path::new("/r/.git/worktrees/x/index")));
        assert!(!counts(c, Path::new("/r/.git/objects/ab/cdef")));
        assert!(!counts(c, Path::new("/r/.git/logs/HEAD")));
        assert!(!counts(c, Path::new("/r/.git/worktrees/x/logs/HEAD")));
        assert!(!counts(c, Path::new("/r/.git/refs/heads/main.lock")));
        assert!(!counts(c, Path::new("/r/.git/index.lock")));
        assert!(!counts(c, Path::new("/r/src/main.rs")));
    }

    #[test]
    fn a_plain_folder_is_not_watched() {
        let dir = tempfile::tempdir().unwrap();
        assert!(start(dir.path(), || {}).is_err());
    }

    #[test]
    fn a_stage_a_commit_and_a_worktree_made_outside_are_reported() {
        let (_dir, path) = repo();
        let (_w, rx) = watching(&path);

        std::fs::write(path.join("b.md"), "b").unwrap();
        git(&path, &["add", "b.md"]);
        assert!(reported(&rx), "a stage was not reported");
        while rx.try_recv().is_ok() {}

        git(&path, &["commit", "-m", "second"]);
        assert!(reported(&rx), "a commit was not reported");
        std::thread::sleep(Duration::from_millis(400));
        while rx.try_recv().is_ok() {}

        let outside = tempfile::tempdir().unwrap();
        let linked = PathBuf::from(crate::worktreeloc::canonical_temp(outside.path())).join("wt");
        git(
            &path,
            &["worktree", "add", "-b", "feat/x", linked.to_str().unwrap()],
        );
        assert!(reported(&rx), "a new worktree was not reported");
        std::thread::sleep(Duration::from_millis(400));
        while rx.try_recv().is_ok() {}

        // A commit made in the linked worktree moves its branch in the shared refs.
        std::fs::write(linked.join("c.md"), "c").unwrap();
        git(&linked, &["add", "c.md"]);
        git(&linked, &["commit", "-m", "in the worktree"]);
        assert!(
            reported(&rx),
            "a commit in a linked worktree was not reported"
        );
    }

    #[test]
    fn a_plain_folder_reports_becoming_a_repository_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let path = PathBuf::from(crate::worktreeloc::canonical_temp(dir.path()));
        assert_eq!(kind_of(&path), Some(Kind::Folder));
        let (tx, rx) = mpsc::channel();
        let (kind, _w) = start_any(&path, move || {
            let _ = tx.send(());
        })
        .unwrap();
        assert_eq!(kind, Kind::Folder);
        std::thread::sleep(Duration::from_millis(400));
        while rx.try_recv().is_ok() {}

        std::fs::write(path.join("notes.md"), "x").unwrap();
        assert!(
            rx.recv_timeout(Duration::from_millis(1500)).is_err(),
            "a file is not a git change"
        );

        git(&path, &["init", "-b", "main"]);
        assert!(reported(&rx), "`git init` was not reported");
        assert_eq!(kind_of(&path), Some(Kind::Repository));
    }

    #[test]
    fn nothing_there_is_not_watched() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(kind_of(&dir.path().join("gone")), None);
        assert!(start_any(&dir.path().join("gone"), || {}).is_err());
    }

    #[test]
    fn editing_the_working_tree_is_not_a_git_change() {
        let (_dir, path) = repo();
        let (_w, rx) = watching(&path);
        std::fs::write(path.join("a.md"), "edited").unwrap();
        std::fs::create_dir_all(path.join("node_modules/x")).unwrap();
        std::fs::write(path.join("node_modules/x/i.js"), "1").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err());
    }
}
