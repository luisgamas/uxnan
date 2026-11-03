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
//! Only one root is watched at a time (the active worktree). Aiming the watch
//! at the root it already watches keeps the running one.
//! Re-pointing it drops the previous one (stopping its background thread)
//! and builds a fresh one off the async runtime: starting a watch can walk the
//! folder (Linux puts a watch on every directory), and that must never stall
//! the commands sharing a runtime thread. Calls are taken in order and a call
//! a newer one has overtaken is skipped, so quick switches never leave several
//! starts racing each other. The watcher itself is the workspace engine's
//! (`uxnan_workspace_engine::watch`), the same one a host's engine runs on a
//! remote project: what it reports is held to the watched folder, it indexes
//! nothing per file and follows no symbolic link, and git's own churn under
//! `.git` never drives the user-facing tree (which also hides `.git`).

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::DebounceEventResult;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uxnan_workspace_engine::watch::{self, Watch};

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
    /// Which machine the root is on (`local`, or `ssh:<hostId>` for a folder a
    /// host's engine watches): the same path can exist on both, and a change
    /// on one must not reload the other.
    pub target: String,
    /// Something under the root's `.git` changed (a commit, a stage, a
    /// checkout made outside the app). Only a host's engine reports it — this
    /// machine's git panel has its own status watcher.
    pub git: bool,
}

/// Holds the active filesystem watcher. Re-pointing the watch swaps the inner
/// one; dropping the old one stops its watcher thread.
#[derive(Default)]
pub struct FsWatcher {
    inner: Mutex<Option<Watching>>,
    /// The last call's ticket: a call that finds a newer one waiting behind it
    /// leaves the decision to that one.
    latest: AtomicU64,
}

/// The running watch and the root it is on.
struct Watching {
    root: String,
    _watch: Watch,
}

impl FsWatcher {
    /// Watch `root` recursively (or stop watching when `None`). The latest
    /// call wins; one for the root already watched keeps the running watch.
    pub async fn set(&self, app: &AppHandle, root: Option<String>) -> notify::Result<()> {
        let ticket = self.latest.fetch_add(1, Ordering::SeqCst) + 1;
        let mut inner = self.inner.lock().await;
        if self.latest.load(Ordering::SeqCst) != ticket {
            return Ok(());
        }
        if inner.as_ref().map(|w| w.root.as_str()) == root.as_deref() {
            return Ok(());
        }
        // Drop the previous watch first so its thread stops before a new one
        // starts (avoids two watchers briefly racing on the same tree).
        *inner = None;
        let Some(root) = root else {
            return Ok(());
        };
        let emit_app = app.clone();
        let emit_root = root.replace('\\', "/");
        let watched = root.clone();
        let started = tokio::task::spawn_blocking(move || {
            watch::start(&watched, move |batch| {
                // An overflow lists nothing; reporting the root makes the tree
                // reload what it shows from the top. Git's own churn alone is
                // not reported here: this machine's git panel has its own
                // status watcher.
                let paths = if batch.overflow {
                    vec![emit_root.clone()]
                } else {
                    batch.paths
                };
                if paths.is_empty() {
                    return;
                }
                let _ = emit_app.emit(
                    "fs:changed",
                    FsChangedEvent {
                        root: emit_root.clone(),
                        paths,
                        target: "local".to_string(),
                        git: false,
                    },
                );
            })
        })
        .await
        .map_err(|e| notify::Error::generic(&e.to_string()))??;
        *inner = Some(Watching {
            root,
            _watch: started,
        });
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
    inner: Mutex<Option<Watch>>,
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
        let mut debouncer = watch::debounced(
            Duration::from_millis(250),
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
        debouncer.watch(Path::new(&dir_norm), RecursiveMode::NonRecursive)?;
        *self.inner.lock().await = Some(debouncer);
        Ok(())
    }
}
