//! On-disk layout for automations — designed so **two processes never write the
//! same file**.
//!
//! The app and a headless runner can be alive at the same moment (a run fires
//! while you have uxnan open), so instead of locking a shared mutable blob, each
//! file has exactly one writer:
//!
//! ```text
//! <data_dir>/automations/
//!   automations.json                  ← definitions. Written ONLY by the app
//!   runs/<automationId>/<runId>.json  ← one run per file. Written ONLY by its runner
//!   logs/<runId>.log                  ← that runner's log
//! ```
//!
//! Nothing is ever read-modify-written across processes, so there are no locks
//! and no lost updates. Because a runner rewrites its own file as steps advance,
//! the app can show **live progress** just by watching the directory. Derived
//! facts (last run, last outputs) are read back from `runs/`, never written into
//! the definition file by the runner.
//!
//! Every write uses the same write-rename pattern as [`crate::persistence`]: an
//! interrupted write can never leave a half-parsed record behind.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{Automation, AutomationRun, RunStatus};
use crate::error::AppError;

/// Bundle identifier from `tauri.conf.json`. The runner has no Tauri app handle,
/// so it resolves the same data directory Tauri would hand the app — keep this
/// in sync with `identifier` there.
const APP_IDENTIFIER: &str = "dev.luisgamas.uxnandesktop";

/// Subdirectory holding everything in this module.
const DIR: &str = "automations";
const DEFINITIONS_FILE: &str = "automations.json";
const RUNS_DIR: &str = "runs";
const LOGS_DIR: &str = "logs";

/// Schema version of `automations.json`, so a future shape change can migrate
/// rather than guess.
const DOC_VERSION: u32 = 1;

/// The persisted definitions document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DefinitionsDoc {
    version: u32,
    #[serde(default)]
    automations: Vec<Automation>,
}

/// Resolve the app data directory **without** a Tauri handle, matching what
/// `app.path().app_data_dir()` returns on each platform. Used by the headless
/// runner, which has no app at all.
pub fn app_data_dir() -> Result<PathBuf, AppError> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);

    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|h| h.join("Library").join("Application Support"));

    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|h| h.join(".local").join("share"))
        });

    base.map(|b| b.join(APP_IDENTIFIER)).ok_or_else(|| {
        AppError::NotFound("could not resolve the application data directory".into())
    })
}

/// Reads and writes the automations tree. Cheap to construct; holds no state
/// beyond its root, so the app and the runner each build their own.
#[derive(Debug, Clone)]
pub struct AutomationStore {
    root: PathBuf,
}

impl AutomationStore {
    /// Root the store under `data_dir` (typically [`app_data_dir`]).
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self {
            root: data_dir.as_ref().join(DIR),
        }
    }

    /// The store rooted at the real application data directory.
    pub fn open_default() -> Result<Self, AppError> {
        Ok(Self::new(app_data_dir()?))
    }

    fn definitions_path(&self) -> PathBuf {
        self.root.join(DEFINITIONS_FILE)
    }

    /// Directory holding one automation's run records.
    pub fn runs_dir(&self, automation_id: &str) -> PathBuf {
        self.root.join(RUNS_DIR).join(automation_id)
    }

    /// Path of a runner's log file.
    pub fn log_path(&self, run_id: &str) -> PathBuf {
        self.root.join(LOGS_DIR).join(format!("{run_id}.log"))
    }

    /// The directory the app should watch to see runs appear and advance.
    pub fn watch_root(&self) -> PathBuf {
        self.root.join(RUNS_DIR)
    }

    // --- Definitions (single writer: the app) --------------------------------

    /// Every saved automation. An absent file is an empty list, not an error —
    /// a first launch has nothing yet.
    pub fn load(&self) -> Result<Vec<Automation>, AppError> {
        let path = self.definitions_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = std::fs::read_to_string(&path)?;
        let doc: DefinitionsDoc = serde_json::from_str(&raw)?;
        if doc.version > DOC_VERSION {
            return Err(AppError::UnsupportedVersion(doc.version));
        }
        Ok(doc.automations)
    }

    /// Replace the definitions atomically. **Only the app calls this** — a
    /// runner must never write here, or two processes would race the file.
    pub fn save(&self, automations: &[Automation]) -> Result<(), AppError> {
        let doc = DefinitionsDoc {
            version: DOC_VERSION,
            automations: automations.to_vec(),
        };
        write_atomic(
            &self.definitions_path(),
            &serde_json::to_string_pretty(&doc)?,
        )
    }

    /// One automation by id.
    pub fn get(&self, id: &str) -> Result<Option<Automation>, AppError> {
        Ok(self.load()?.into_iter().find(|a| a.id == id))
    }

    // --- Runs (single writer: the runner that owns the run) ------------------

    /// Write (or rewrite) a run record atomically. Called repeatedly by its own
    /// runner as steps advance, which is what gives the app live progress.
    pub fn write_run(&self, run: &AutomationRun) -> Result<(), AppError> {
        let path = self
            .runs_dir(&run.automation_id)
            .join(format!("{}.json", run.id));
        write_atomic(&path, &serde_json::to_string_pretty(run)?)
    }

    /// An automation's runs, newest first. Unreadable records are skipped rather
    /// than failing the whole listing: one corrupt file must not hide the
    /// history around it.
    pub fn list_runs(&self, automation_id: &str) -> Result<Vec<AutomationRun>, AppError> {
        let dir = self.runs_dir(automation_id);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut runs: Vec<AutomationRun> = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Ok(run) = serde_json::from_str::<AutomationRun>(&raw) {
                    runs.push(run);
                }
            }
        }
        runs.sort_by_key(|r| std::cmp::Reverse(r.started_at));
        Ok(runs)
    }

    /// The most recent finished run, whatever its outcome — the source of the
    /// `{{prev.*}}` values that let a recurring automation pick up where the
    /// last one left off.
    pub fn last_finished_run(
        &self,
        automation_id: &str,
    ) -> Result<Option<AutomationRun>, AppError> {
        Ok(self
            .list_runs(automation_id)?
            .into_iter()
            .find(|r| r.status.is_final()))
    }

    /// Whether a run of this automation is still in flight — what the overlap
    /// policy consults.
    ///
    /// A runner killed mid-run leaves its record on `Running` forever, so a run
    /// older than `max_run_minutes` is treated as **stale, not live**: a crashed
    /// process must never block every future run.
    pub fn has_live_run(
        &self,
        automation_id: &str,
        max_run_minutes: u32,
        now_ms: i64,
    ) -> Result<bool, AppError> {
        let cutoff = i64::from(max_run_minutes) * 60_000;
        Ok(self.list_runs(automation_id)?.iter().any(|r| {
            r.status == RunStatus::Running && now_ms.saturating_sub(r.started_at) <= cutoff
        }))
    }

    /// Keep the newest `keep` finished runs and delete the rest, so history
    /// can't grow without bound. In-flight runs are never pruned. Returns how
    /// many records were removed.
    pub fn prune_runs(&self, automation_id: &str, keep: u32) -> Result<usize, AppError> {
        let runs = self.list_runs(automation_id)?;
        let dir = self.runs_dir(automation_id);
        let mut removed = 0usize;
        let mut kept = 0u32;
        for run in runs {
            if !run.status.is_final() {
                continue;
            }
            if kept < keep {
                kept += 1;
                continue;
            }
            let path = dir.join(format!("{}.json", run.id));
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
                // The log is best-effort: losing it must not fail the prune.
                let _ = std::fs::remove_file(self.log_path(&run.id));
            }
        }
        Ok(removed)
    }

    /// Drop everything belonging to a deleted automation.
    pub fn remove_runs(&self, automation_id: &str) -> Result<(), AppError> {
        let dir = self.runs_dir(automation_id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        Ok(())
    }
}

/// Serialize to `<path>.tmp` and rename over the target. `rename` is atomic on
/// every supported OS, so a reader never sees a half-written record.
fn write_atomic(path: &Path, contents: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents.as_bytes())?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automations::{Automation, Policy, RunTrigger, Schedule, Step};

    fn automation(id: &str) -> Automation {
        Automation {
            id: id.into(),
            name: format!("Automation {id}"),
            description: String::new(),
            icon: None,
            enabled: true,
            tags: vec!["triage".into()],
            working_dir: "C:/work".into(),
            worktree_per_run: false,
            base_branch: None,
            schedule: Schedule::DailyAt { hour: 3, minute: 0 },
            policy: Policy::default(),
            steps: vec![Step {
                id: "s1".into(),
                title: "Analyze".into(),
                agent: "claude".into(),
                model: String::new(),
                prompt: "go".into(),
                depends_on: vec![],
                on_failure: super::super::OnFailure::Stop,
                max_attempts: 1,
                timeout_ms: None,
            }],
            created_at: 1,
            updated_at: 1,
        }
    }

    fn run_at(store: &AutomationStore, id: &str, started_at: i64, status: RunStatus) {
        let a = automation("a1");
        let mut run = AutomationRun::start(&a, id.into(), RunTrigger::Scheduled);
        run.started_at = started_at;
        run.status = status;
        store.write_run(&run).unwrap();
    }

    #[test]
    fn definitions_round_trip_and_missing_file_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let store = AutomationStore::new(tmp.path());
        assert!(store.load().unwrap().is_empty());

        let items = vec![automation("a1"), automation("a2")];
        store.save(&items).unwrap();
        assert_eq!(store.load().unwrap(), items);
        assert_eq!(store.get("a2").unwrap().unwrap().id, "a2");
        assert!(store.get("nope").unwrap().is_none());
    }

    #[test]
    fn a_future_schema_version_is_refused_not_guessed() {
        let tmp = tempfile::tempdir().unwrap();
        let store = AutomationStore::new(tmp.path());
        std::fs::create_dir_all(tmp.path().join(DIR)).unwrap();
        std::fs::write(
            store.definitions_path(),
            r#"{"version":99,"automations":[]}"#,
        )
        .unwrap();
        assert!(matches!(
            store.load().unwrap_err(),
            AppError::UnsupportedVersion(99)
        ));
    }

    #[test]
    fn runs_are_listed_newest_first_and_survive_a_corrupt_neighbor() {
        let tmp = tempfile::tempdir().unwrap();
        let store = AutomationStore::new(tmp.path());
        run_at(&store, "r1", 1_000, RunStatus::Completed);
        run_at(&store, "r2", 3_000, RunStatus::Failed);
        run_at(&store, "r3", 2_000, RunStatus::Completed);
        // A truncated write from an older build must not hide the rest.
        std::fs::write(store.runs_dir("a1").join("broken.json"), "{ not json").unwrap();

        let ids: Vec<String> = store
            .list_runs("a1")
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["r2", "r3", "r1"]);
    }

    #[test]
    fn rewriting_a_run_keeps_one_record() {
        // The runner rewrites its own file as steps advance — that must update
        // in place, never accumulate.
        let tmp = tempfile::tempdir().unwrap();
        let store = AutomationStore::new(tmp.path());
        run_at(&store, "r1", 1_000, RunStatus::Running);
        run_at(&store, "r1", 1_000, RunStatus::Completed);
        let runs = store.list_runs("a1").unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, RunStatus::Completed);
    }

    #[test]
    fn last_finished_run_skips_one_still_running() {
        let tmp = tempfile::tempdir().unwrap();
        let store = AutomationStore::new(tmp.path());
        run_at(&store, "old", 1_000, RunStatus::Completed);
        run_at(&store, "live", 5_000, RunStatus::Running);
        assert_eq!(store.last_finished_run("a1").unwrap().unwrap().id, "old");
    }

    #[test]
    fn a_stale_running_record_does_not_block_future_runs() {
        let tmp = tempfile::tempdir().unwrap();
        let store = AutomationStore::new(tmp.path());
        // A runner that was killed 3 h ago, with a 60-minute ceiling.
        run_at(&store, "zombie", 0, RunStatus::Running);
        let now = 3 * 60 * 60_000;
        assert!(!store.has_live_run("a1", 60, now).unwrap());
        // One inside the window is genuinely live.
        run_at(&store, "fresh", now - 60_000, RunStatus::Running);
        assert!(store.has_live_run("a1", 60, now).unwrap());
    }

    #[test]
    fn prune_keeps_the_newest_and_never_touches_a_live_run() {
        let tmp = tempfile::tempdir().unwrap();
        let store = AutomationStore::new(tmp.path());
        run_at(&store, "r1", 1_000, RunStatus::Completed);
        run_at(&store, "r2", 2_000, RunStatus::Completed);
        run_at(&store, "r3", 3_000, RunStatus::Failed);
        run_at(&store, "live", 4_000, RunStatus::Running);

        assert_eq!(store.prune_runs("a1", 2).unwrap(), 1);
        let ids: Vec<String> = store
            .list_runs("a1")
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        // Newest two finished (r3, r2) kept, r1 dropped, the live run untouched.
        assert_eq!(ids, vec!["live", "r3", "r2"]);
    }

    #[test]
    fn removing_an_automation_drops_its_history() {
        let tmp = tempfile::tempdir().unwrap();
        let store = AutomationStore::new(tmp.path());
        run_at(&store, "r1", 1_000, RunStatus::Completed);
        store.remove_runs("a1").unwrap();
        assert!(store.list_runs("a1").unwrap().is_empty());
        // Idempotent: removing again is not an error.
        store.remove_runs("a1").unwrap();
    }
}
