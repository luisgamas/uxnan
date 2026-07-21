//! Filesystem watcher backing the right-panel **file tree** and the open-file
//! **editor**.
//!
//! The git watcher (`lib.rs`) only polls *status* (which tracked files changed);
//! it never sees a brand-new untracked file appear or a file vanish until the
//! next poll, and it tells the file *tree* nothing. This module watches the
//! active worktree root recursively and emits a debounced `fs:changed` event so
//! the tree can reload just the affected directories — and an open editor can
//! notice its file changed on disk — without a manual refresh.
//!
//! Only one root is watched at a time (the active worktree); re-pointing the
//! watch drops the previous debouncer (stopping its background thread) and
//! builds a fresh one. Paths under a `.git` directory are ignored — git's own
//! churn must never drive the user-facing tree (which also hides `.git`).

use std::collections::BTreeSet;
use std::path::{Component, Path};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// Payload of the `fs:changed` event: the watched root plus the affected paths
/// (each changed file and its parent directory), all forward-slash normalized so
/// they line up with the paths the file tree already holds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedEvent {
    /// The watched worktree root the changes are under (forward-slash).
    pub root: String,
    /// Affected paths (forward-slash): changed entries + their parent dirs.
    pub paths: Vec<String>,
}

type FsDebouncer = Debouncer<RecommendedWatcher, FileIdMap>;

/// Holds the active filesystem watcher. Re-pointing the watch swaps the inner
/// debouncer; dropping the old one stops its watcher thread.
#[derive(Default)]
pub struct FsWatcher {
    inner: Mutex<Option<FsDebouncer>>,
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// True when `path` lives inside (or is) a `.git` directory — its internals are
/// never browsed/edited, so their churn must not drive the tree.
fn is_ignored(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::Normal(name) if name == ".git"))
}

impl FsWatcher {
    /// Watch `root` recursively (or stop watching when `None`). Idempotent: a
    /// new call always replaces the previous watch.
    pub async fn set(&self, app: &AppHandle, root: Option<String>) -> notify::Result<()> {
        // Drop the previous debouncer first so its thread stops before a new one
        // starts (avoids two watchers briefly racing on the same tree).
        *self.inner.lock().await = None;
        let Some(root) = root else {
            return Ok(());
        };
        let root_norm = root.replace('\\', "/");
        let emit_app = app.clone();
        let emit_root = root_norm.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(300),
            None,
            move |result: DebounceEventResult| {
                let Ok(events) = result else {
                    return; // watcher errors are non-fatal; skip this batch
                };
                let mut paths: BTreeSet<String> = BTreeSet::new();
                for event in events {
                    for path in &event.paths {
                        if is_ignored(path) {
                            continue;
                        }
                        paths.insert(normalize(path));
                        if let Some(parent) = path.parent() {
                            paths.insert(normalize(parent));
                        }
                    }
                }
                if paths.is_empty() {
                    return;
                }
                let _ = emit_app.emit(
                    "fs:changed",
                    FsChangedEvent {
                        root: emit_root.clone(),
                        paths: paths.into_iter().collect(),
                    },
                );
            },
        )?;
        debouncer
            .watcher()
            .watch(Path::new(&root), RecursiveMode::Recursive)?;
        // Track the root in the file-id cache too, so renames/removals under it
        // are resolved correctly by the debouncer.
        debouncer
            .cache()
            .add_root(Path::new(&root), RecursiveMode::Recursive);
        *self.inner.lock().await = Some(debouncer);
        Ok(())
    }
}

/// Payload of the `browse:changed` event: the single directory the in-app folder
/// browser is currently viewing (forward-slash). The frontend re-lists it when
/// this matches the folder it's showing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseChangedEvent {
    /// The watched directory (forward-slash normalized).
    pub path: String,
}

/// Holds the in-app directory browser's watcher. Unlike [`FsWatcher`] this is a
/// **non-recursive**, single-directory watch (the browser lists one level at a
/// time), so a folder created/removed directly inside the browsed directory —
/// even from outside the app — shows up without a manual refresh. Re-pointing the
/// watch (navigating) or closing the dialog swaps/drops the inner debouncer.
#[derive(Default)]
pub struct BrowseWatcher {
    inner: Mutex<Option<FsDebouncer>>,
}

impl BrowseWatcher {
    /// Watch `dir` non-recursively (or stop watching when `None`). Idempotent: a
    /// new call always replaces the previous watch.
    pub async fn set(&self, app: &AppHandle, dir: Option<String>) -> notify::Result<()> {
        // Drop the previous debouncer first so its thread stops before a new one
        // starts (mirrors `FsWatcher::set`).
        *self.inner.lock().await = None;
        let Some(dir) = dir else {
            return Ok(());
        };
        let dir_norm = dir.replace('\\', "/");
        let emit_app = app.clone();
        let emit_dir = dir_norm.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(250),
            None,
            move |result: DebounceEventResult| {
                if result.is_err() {
                    return; // watcher errors are non-fatal; skip this batch
                }
                let _ = emit_app.emit(
                    "browse:changed",
                    BrowseChangedEvent {
                        path: emit_dir.clone(),
                    },
                );
            },
        )?;
        debouncer
            .watcher()
            .watch(Path::new(&dir_norm), RecursiveMode::NonRecursive)?;
        *self.inner.lock().await = Some(debouncer);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_paths_inside_dot_git() {
        assert!(is_ignored(Path::new("/repo/.git/index")));
        assert!(is_ignored(Path::new("/repo/.git")));
        assert!(is_ignored(Path::new("C:/repo/.git/refs/heads/main")));
        assert!(!is_ignored(Path::new("/repo/src/main.rs")));
        assert!(!is_ignored(Path::new("/repo/.gitignore")));
    }

    #[test]
    fn normalize_uses_forward_slashes() {
        assert_eq!(normalize(Path::new("a/b/c.txt")), "a/b/c.txt");
    }
}
