//! Watching a project folder for the file tree, the editor and the git panel.
//!
//! One watcher for both machines: the desktop runs it on its active worktree,
//! the host daemon on the folder a host's project shows. Recursive, debounced
//! at 300 ms, each changed path reported with its parent folder so the tree
//! reloads the folders it shows. What it reports is held to the watched
//! folder: the platform's watcher can name paths outside it (macOS reports the
//! creation of the watched folder itself, and its parent, from history), and
//! git's own churn under `.git` is never a path — only a flag.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};

/// Paths one batch lists at most. A `git checkout` or a build can touch
/// thousands; past this the batch says "reload the folder" instead.
pub const MAX_PATHS: usize = 512;

/// A running watch. Dropping it stops its thread.
pub type Watch = Debouncer<RecommendedWatcher, FileIdMap>;

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
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
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
    debouncer
        .watcher()
        .watch(Path::new(root), RecursiveMode::Recursive)?;
    // Track the root in the file-id cache too, so renames and removals under
    // it are resolved.
    debouncer
        .cache()
        .add_root(Path::new(root), RecursiveMode::Recursive);
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

    #[test]
    fn too_many_changes_ask_for_a_reload() {
        let changed: Vec<String> = (0..MAX_PATHS).map(|i| format!("/p/f{i}")).collect();
        let changed: Vec<&str> = changed.iter().map(String::as_str).collect();
        let got = batch(&["/p"], &changed).unwrap();
        assert!(got.overflow);
        assert!(got.paths.is_empty());
    }
}
