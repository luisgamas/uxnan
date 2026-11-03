//! Watching every local project's git directory, so the sidebar learns that a
//! worktree appeared, a branch moved or something was staged when it happens —
//! instead of asking `git worktree list` of every project every few seconds.
//!
//! The frontend names the local projects (`git_watch_repos`) and gets back the
//! ones actually watched; a project left out (a platform that refused the
//! watch, a folder that is not there) keeps being reconciled on the sidebar's
//! timer exactly as before. A repository's git directory is watched; a plain
//! folder is watched for `.git` appearing in it — and a project that changes
//! kind (`git init`, `.git` removed) is re-armed the next time the set is
//! named. Each change is a `git:repo-changed` event naming the project's path.
//! The watcher is the engine's (`uxnan_workspace_engine::gitwatch`): never the
//! working tree, nothing indexed.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uxnan_workspace_engine::gitwatch::{self, Kind};
use uxnan_workspace_engine::watch::Watch;

/// Payload of `git:repo-changed`: the project whose git directory moved, as the
/// frontend named it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChangedEvent {
    pub repo: String,
}

/// The running watches, one per project path, with the kind each was armed as.
#[derive(Default)]
pub struct RepoWatcher {
    inner: Mutex<HashMap<String, (Kind, Watch)>>,
    /// The last call's ticket: a call overtaken by a newer one leaves the set
    /// to it (the same rule as the folder watcher).
    latest: AtomicU64,
}

impl RepoWatcher {
    /// Watch exactly `repos` (dropping the rest) and answer which of them are
    /// watched. A project already watched keeps its watch.
    pub async fn set(&self, app: &AppHandle, repos: Vec<String>) -> Vec<String> {
        let ticket = self.latest.fetch_add(1, Ordering::SeqCst) + 1;
        let mut inner = self.inner.lock().await;
        if self.latest.load(Ordering::SeqCst) != ticket {
            return inner.keys().cloned().collect();
        }
        let wanted: HashSet<String> = repos.into_iter().collect();
        inner.retain(|repo, _| wanted.contains(repo));
        let armed: Vec<(String, Kind)> = inner.iter().map(|(r, (k, _))| (r.clone(), *k)).collect();
        let fresh: Vec<String> = wanted
            .iter()
            .filter(|repo| !inner.contains_key(*repo))
            .cloned()
            .collect();
        let emit_app = app.clone();
        // Telling a repository from a folder and arming its watch touch the
        // disk: off the async runtime, all of them in one blocking task.
        let (stale, started) = tokio::task::spawn_blocking(move || {
            // A project that changed kind since it was armed is armed again.
            let stale: Vec<String> = armed
                .into_iter()
                .filter(|(repo, kind)| gitwatch::kind_of(&PathBuf::from(repo)) != Some(*kind))
                .map(|(repo, _)| repo)
                .collect();
            let started: Vec<(String, (Kind, Watch))> = fresh
                .into_iter()
                .chain(stale.iter().cloned())
                .filter_map(|repo| {
                    let reporter = emit_app.clone();
                    let named = repo.clone();
                    gitwatch::start_any(&PathBuf::from(&repo), move || {
                        let _ = reporter.emit(
                            "git:repo-changed",
                            RepoChangedEvent {
                                repo: named.clone(),
                            },
                        );
                    })
                    .ok()
                    .map(|armed| (repo, armed))
                })
                .collect();
            (stale, started)
        })
        .await
        .unwrap_or_default();
        for repo in &stale {
            inner.remove(repo);
        }
        inner.extend(started);
        let mut watched: Vec<String> = inner.keys().cloned().collect();
        watched.sort();
        watched
    }
}
