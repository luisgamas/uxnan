//! Watching a project folder for the file tree, the editor and the git panel.
//!
//! One watcher for both machines: the desktop runs it on its active worktree,
//! the host daemon on the folder a host's project shows. Recursive, debounced
//! at 300 ms, each changed path reported with its parent folder so the tree
//! reloads the folders it shows. What it reports is held to the watched
//! folder: the platform's watcher can name paths outside it (macOS reports the
//! creation of the watched folder itself, and its parent, from history), and
//! git's own churn under `.git` is never a path — only a flag.
//!
//! What a watch costs is held to what the platform's watcher keeps, never the
//! size of the folder. Nothing is indexed per file: the debouncer's file-id
//! cache walks the whole tree when a watch starts (and again on every rescan
//! the platform asks for) and keeps an entry per file, so a folder as wide as a
//! home directory — or one holding a VM's mount of the whole disk — grew it
//! without bound, tens of gigabytes. What it buys, pairing a rename's two
//! halves, is nothing to a watcher that only reports paths. And symbolic links
//! are not followed, so a link inside the folder never takes the watch outside
//! it.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer_opt, DebounceEventHandler, DebounceEventResult, Debouncer, NoCache,
};

/// Paths one batch lists at most. A `git checkout` or a build can touch
/// thousands; past this the batch says "reload the folder" instead.
pub const MAX_PATHS: usize = 512;

/// A running watch. Dropping it stops its thread.
pub type Watch = Debouncer<RecommendedWatcher, NoCache>;

/// A debounced watcher that indexes nothing and follows no symbolic link —
/// the only way this app builds one. Nothing is watched until the caller asks.
pub fn debounced<F: DebounceEventHandler>(timeout: Duration, handler: F) -> notify::Result<Watch> {
    new_debouncer_opt(
        timeout,
        None,
        handler,
        NoCache,
        notify::Config::default().with_follow_symlinks(false),
    )
}

/// One debounced batch of changes under the watched folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    /// Changed entries and their parent folders, forward-slash. Empty on an
    /// overflow.
    pub paths: Vec<String>,
    /// More changed than [`MAX_PATHS`]: reload the folder from the top.
    pub overflow: bool,
    /// Something under the folder's `.git` changed (a commit, a stage, a
    /// checkout made outside the app).
    pub git: bool,
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// The forms of `root` an event can name it by: as given, and resolved
/// (`/var/...` is reported as `/private/var/...` on macOS).
fn root_forms(root: &Path) -> Vec<PathBuf> {
    let mut forms = vec![root.to_path_buf()];
    if let Ok(resolved) = std::fs::canonicalize(root) {
        if resolved != root {
            forms.push(resolved);
        }
    }
    forms
}

/// `path` relative to the watched folder, or `None` when it is outside it.
fn inside<'a>(roots: &[PathBuf], path: &'a Path) -> Option<&'a Path> {
    roots.iter().find_map(|root| path.strip_prefix(root).ok())
}

fn in_git(relative: &Path) -> bool {
    relative
        .components()
        .any(|c| matches!(c, Component::Normal(name) if name == ".git"))
}

/// Fold the paths of one debounced batch into what is reported, or `None`
/// when nothing under the folder changed.
fn collect<'a>(roots: &[PathBuf], changed: impl IntoIterator<Item = &'a Path>) -> Option<Batch> {
    let mut paths: BTreeSet<String> = BTreeSet::new();
    let mut git = false;
    for path in changed {
        let Some(relative) = inside(roots, path) else {
            continue;
        };
        if in_git(relative) {
            git = true;
            continue;
        }
        paths.insert(normalize(path));
        if relative.as_os_str().is_empty() {
            continue;
        }
        if let Some(parent) = path.parent() {
            paths.insert(normalize(parent));
        }
    }
    if paths.is_empty() && !git {
        return None;
    }
    let overflow = paths.len() > MAX_PATHS;
    Some(Batch {
        paths: if overflow {
            Vec::new()
        } else {
            paths.into_iter().collect()
        },
        overflow,
        git,
    })
}

/// Watch `root` recursively, calling `report` for each debounced batch.
pub fn start<F>(root: &str, report: F) -> notify::Result<Watch>
where
    F: Fn(Batch) + Send + 'static,
{
    let roots = root_forms(Path::new(root));
    let mut debouncer = debounced(
        Duration::from_millis(300),
        move |result: DebounceEventResult| {
            // A watcher error is not fatal; this batch is skipped.
            let Ok(events) = result else {
                return;
            };
            let changed = events
                .iter()
                .flat_map(|e| e.paths.iter().map(PathBuf::as_path));
            if let Some(batch) = collect(&roots, changed) {
                report(batch);
            }
        },
    )?;
    debouncer.watch(Path::new(root), RecursiveMode::Recursive)?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(roots: &[&str], changed: &[&str]) -> Option<Batch> {
        let roots: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
        let changed: Vec<PathBuf> = changed.iter().map(PathBuf::from).collect();
        collect(&roots, changed.iter().map(PathBuf::as_path))
    }

    #[test]
    fn a_change_is_reported_with_its_folder() {
        let got = batch(&["/p"], &["/p/src/main.rs"]).unwrap();
        assert_eq!(got.paths, vec!["/p/src", "/p/src/main.rs"]);
        assert!(!got.overflow);
        assert!(!got.git);
    }

    #[test]
    fn nothing_outside_the_folder_is_reported() {
        // What macOS hands over for a folder created just before it is watched.
        assert_eq!(batch(&["/tmp/p"], &["/tmp", "/tmp/other"]), None);
        let got = batch(&["/tmp/p"], &["/tmp", "/tmp/p", "/tmp/p/a.md"]).unwrap();
        assert_eq!(got.paths, vec!["/tmp/p", "/tmp/p/a.md"]);
    }

    #[test]
    fn a_change_named_by_the_resolved_folder_counts() {
        let got = batch(&["/var/p", "/private/var/p"], &["/private/var/p/a.md"]).unwrap();
        assert_eq!(got.paths, vec!["/private/var/p", "/private/var/p/a.md"]);
    }

    #[test]
    fn git_internals_are_a_flag_never_a_path() {
        let got = batch(&["/p"], &["/p/.git/index"]).unwrap();
        assert!(got.paths.is_empty());
        assert!(got.git);
        let got = batch(&["/p"], &["/p/.github/workflows/ci.yml"]).unwrap();
        assert!(!got.git);
        // A folder that itself lives under a `.git` path is still watched.
        let got = batch(&["/x/.git/p"], &["/x/.git/p/a.md"]).unwrap();
        assert!(!got.git);
        assert_eq!(got.paths, vec!["/x/.git/p", "/x/.git/p/a.md"]);
    }

    #[test]
    fn paths_are_reported_with_forward_slashes() {
        assert_eq!(normalize(Path::new("C:\\repo\\a.md")), "C:/repo/a.md");
    }

    /// Start a real watch on `root`, forwarding its batches.
    fn watch_real(root: &Path) -> (Watch, std::sync::mpsc::Receiver<Batch>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let watch = start(root.to_str().unwrap(), move |b| {
            let _ = tx.send(b);
        })
        .unwrap();
        // Let the platform's watcher settle before anything changes.
        std::thread::sleep(Duration::from_millis(300));
        (watch, rx)
    }

    /// The paths batches name within `wait`, or until one satisfies `found`.
    fn paths_within(
        rx: &std::sync::mpsc::Receiver<Batch>,
        wait: Duration,
        found: impl Fn(&str) -> bool,
    ) -> Vec<String> {
        let until = std::time::Instant::now() + wait;
        let mut paths = Vec::new();
        while let Some(left) = until.checked_duration_since(std::time::Instant::now()) {
            let Ok(b) = rx.recv_timeout(left) else {
                break;
            };
            paths.extend(b.paths);
            if paths.iter().any(|p| found(p)) {
                break;
            }
        }
        paths
    }

    #[test]
    fn a_real_watch_reports_a_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let (_watch, rx) = watch_real(&root);
        std::fs::write(root.join("new.md"), "x").unwrap();
        let found = |p: &str| p.ends_with("/new.md");
        let paths = paths_within(&rx, Duration::from_secs(5), found);
        assert!(
            paths.iter().any(|p| found(p)),
            "no batch named the new file: {paths:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_folder_is_not_followed() {
        let dir = tempfile::tempdir().unwrap();
        let base = std::fs::canonicalize(dir.path()).unwrap();
        let root = base.join("project");
        let outside = base.join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let (_watch, rx) = watch_real(&root);
        std::fs::write(outside.join("far.md"), "x").unwrap();
        let paths = paths_within(&rx, Duration::from_secs(2), |p| p.ends_with("far.md"));
        assert!(
            !paths.iter().any(|p| p.ends_with("far.md")),
            "a change outside the folder was reported through a link: {paths:?}"
        );
    }

    #[test]
    fn too_many_changes_ask_for_a_reload() {
        let changed: Vec<String> = (0..MAX_PATHS).map(|i| format!("/p/f{i}")).collect();
        let changed: Vec<&str> = changed.iter().map(String::as_str).collect();
        let got = batch(&["/p"], &changed).unwrap();
        assert!(got.overflow);
        assert!(got.paths.is_empty());
    }
}
