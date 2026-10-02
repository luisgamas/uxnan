//! Watching a project folder on the host, for the desktop's file tree, editor
//! and git panel.
//!
//! The same shape as this machine's own watcher (`src-tauri/src/fswatch.rs`):
//! recursive, debounced at 300 ms, `.git` internals ignored, each changed path
//! reported with its parent folder so the tree reloads the folders it shows.
//! The difference is where it runs — here, next to the files — so a project on
//! a host refreshes by itself without the desktop asking the host anything.

use std::collections::BTreeSet;
use std::path::{Component, Path};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};

/// Paths one event lists at most. A `git checkout` or a build can touch
/// thousands; past this the event says "reload the folder" instead.
const MAX_PATHS: usize = 512;

pub type Watch = Debouncer<RecommendedWatcher, FileIdMap>;

fn ignored(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::Normal(name) if name == ".git"))
}

/// Watch `root`, calling `report(paths, overflow, git)` for each debounced
/// batch.
pub fn start<F>(root: &str, report: F) -> notify::Result<Watch>
where
    F: Fn(Vec<String>, bool, bool) + Send + 'static,
{
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let mut paths: BTreeSet<String> = BTreeSet::new();
            let mut git = false;
            for event in events {
                for path in &event.paths {
                    if ignored(path) {
                        git = true;
                        continue;
                    }
                    paths.insert(path.to_string_lossy().to_string());
                    if let Some(parent) = path.parent() {
                        paths.insert(parent.to_string_lossy().to_string());
                    }
                }
            }
            if paths.is_empty() && !git {
                return;
            }
            let overflow = paths.len() > MAX_PATHS;
            let listed = if overflow {
                Vec::new()
            } else {
                paths.into_iter().collect()
            };
            report(listed, overflow, git);
        },
    )?;
    debouncer
        .watcher()
        .watch(Path::new(root), RecursiveMode::Recursive)?;
    debouncer
        .cache()
        .add_root(Path::new(root), RecursiveMode::Recursive);
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_internals_never_count_as_a_change() {
        assert!(ignored(Path::new("/p/.git/index")));
        assert!(ignored(Path::new("/p/.git")));
        assert!(!ignored(Path::new("/p/src/main.rs")));
        assert!(!ignored(Path::new("/p/.github/workflows/ci.yml")));
    }
}
