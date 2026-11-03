//! Crash-safe JSON persistence for [`AppData`].
//!
//! Writes use the **write-rename** pattern: serialize to `<file>.tmp`, then
//! `rename` it over the target. `rename` is atomic on every supported OS, so an
//! interrupted write can never leave a half-written `state.json` — the previous
//! good copy stays intact.
//!
//! Before a write the current file is rotated into a ring of **5 numbered
//! backups** (`state.bak.1` … `state.bak.5`), so a bad migration or a corrupt
//! write can be recovered from a recent snapshot — at most once every
//! [`BACKUP_EVERY`]. Rotating on every save made the five copies the last
//! fraction of a second whenever agents were reporting, which recovers
//! nothing. The first save of a session always backs up what the last session
//! left. Loading applies forward schema migrations in sequence (see
//! [`migrate`]).
//!
//! A save something waits on is written at once ([`PersistenceManager::save`]).
//! What only has to survive a restart and changes far more often than it is
//! worth writing — the agents' reported state, which arrives with every tool
//! call — is asked for with [`PersistenceManager::save_soon`]: one background
//! task writes the latest state at most once per [`COALESCE`], and the app
//! writes whatever is still pending when it exits.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::model::{AppData, SCHEMA_VERSION};

/// File name of the persisted state document inside the app data directory.
const STATE_FILE: &str = "state.json";

/// Number of rotating backups kept alongside `state.json` (spec §7).
const MAX_BACKUPS: usize = 5;

/// How often the backup ring may turn.
pub const BACKUP_EVERY: Duration = Duration::from_secs(10 * 60);

/// How long a [`PersistenceManager::save_soon`] waits for more of the same.
pub const COALESCE: Duration = Duration::from_secs(1);

/// Owns the on-disk location of the ADE's persisted state and performs the
/// atomic load/save.
#[derive(Debug, Clone)]
pub struct PersistenceManager {
    path: PathBuf,
    backup_every: Duration,
    /// When the backup ring last turned (`None`: not yet this session).
    backed_up_at: Arc<Mutex<Option<Instant>>>,
    /// A [`save_soon`](Self::save_soon) not written yet.
    pending: Arc<AtomicBool>,
    wake: Arc<tokio::sync::Notify>,
}

impl PersistenceManager {
    /// Build a manager rooted at `data_dir` (typically `app_data_dir()`).
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self::with_backup_interval(data_dir, BACKUP_EVERY)
    }

    /// [`new`](Self::new) with another backup cadence.
    pub fn with_backup_interval(data_dir: impl AsRef<Path>, backup_every: Duration) -> Self {
        Self {
            path: data_dir.as_ref().join(STATE_FILE),
            backup_every,
            backed_up_at: Arc::new(Mutex::new(None)),
            pending: Arc::new(AtomicBool::new(false)),
            wake: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// Load persisted state, returning defaults when nothing is on disk yet.
    /// Applies forward migrations when the stored schema version is older.
    pub fn load(&self) -> Result<AppData, AppError> {
        if !self.path.exists() {
            return Ok(AppData::default());
        }
        let raw = std::fs::read_to_string(&self.path)?;
        let value: serde_json::Value = serde_json::from_str(&raw)?;
        let migrated = migrate(value)?;
        Ok(serde_json::from_value(migrated)?)
    }

    /// Persist `data` atomically (rotate backups when due → write temp →
    /// rename over target). Backup rotation is best-effort: a failed snapshot
    /// never blocks the actual save. A pending [`save_soon`](Self::save_soon)
    /// is not consumed here: the next coalesced write repeats this one, harmless.
    pub fn save(&self, data: &AppData) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(data)?;
        self.rotate_backups_when_due();
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, json.as_bytes())?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Ask for the state to be written soon. The task waiting on
    /// [`next_coalesced`](Self::next_coalesced) writes it.
    pub fn save_soon(&self) {
        self.pending.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }

    /// Wait until a [`save_soon`](Self::save_soon) is due: [`COALESCE`] after
    /// the first request, folding in every request made meanwhile.
    pub async fn next_coalesced(&self) {
        loop {
            self.wake.notified().await;
            tokio::time::sleep(COALESCE).await;
            if self.pending.swap(false, Ordering::SeqCst) {
                return;
            }
        }
    }

    /// Whether a [`save_soon`](Self::save_soon) is still unwritten — taken, so
    /// the caller writes it (on exit).
    pub fn take_pending(&self) -> bool {
        self.pending.swap(false, Ordering::SeqCst)
    }

    fn rotate_backups_when_due(&self) {
        let mut at = self.backed_up_at.lock().unwrap_or_else(|e| e.into_inner());
        if at.is_some_and(|t| t.elapsed() < self.backup_every) {
            return;
        }
        if self.rotate_backups() {
            *at = Some(Instant::now());
        }
    }

    /// Rotate the current `state.json` into the backup ring before it is
    /// overwritten: `bak.4→bak.5` (oldest dropped), …, `bak.1→bak.2`, then the
    /// live file is copied to `bak.1`. Best-effort — errors are ignored so a
    /// backup problem can't stop the save. Answers whether there was a file to
    /// back up.
    fn rotate_backups(&self) -> bool {
        if !self.path.exists() {
            return false;
        }
        for i in (1..MAX_BACKUPS).rev() {
            let from = self.path.with_extension(format!("bak.{i}"));
            if from.exists() {
                let to = self.path.with_extension(format!("bak.{}", i + 1));
                let _ = std::fs::rename(&from, &to);
            }
        }
        let _ = std::fs::copy(&self.path, self.path.with_extension("bak.1"));
        true
    }
}

/// Apply forward schema migrations in sequence until the JSON matches
/// [`SCHEMA_VERSION`], then stamp the current version.
///
/// A document with no `version` field is treated as the current version (legacy
/// docs predate the field but already have the current shape). A version newer
/// than this binary understands is rejected, so an older binary never silently
/// corrupts data written by a newer one.
fn migrate(mut value: serde_json::Value) -> Result<serde_json::Value, AppError> {
    let mut version = value
        .get("version")
        .and_then(|v| v.as_u64())
        .unwrap_or(SCHEMA_VERSION as u64) as u32;

    if version > SCHEMA_VERSION {
        return Err(AppError::UnsupportedVersion(version));
    }
    // Apply one step at a time so each future bump is an independent, testable
    // transform (`v → v+1`).
    while version < SCHEMA_VERSION {
        value = migrate_step(version, value)?;
        version += 1;
    }
    if let Some(obj) = value.as_object_mut() {
        obj.insert("version".into(), serde_json::json!(SCHEMA_VERSION));
    }
    remove_retired_gemini_state(&mut value);
    Ok(value)
}

/// Remove persisted selections owned by the retired standalone Gemini CLI.
/// This deliberately matches only its exact ids/command; Antigravity's `agy`
/// profile, `.gemini` storage paths and Gemini-family model ids are untouched.
fn remove_retired_gemini_state(value: &mut serde_json::Value) {
    let Some(settings) = value.get_mut("settings") else {
        return;
    };

    if let Some(profiles) = settings
        .get_mut("agentProfiles")
        .and_then(|v| v.as_array_mut())
    {
        profiles.retain(|profile| {
            profile.get("id").and_then(|v| v.as_str()) != Some("gemini")
                && profile.get("command").and_then(|v| v.as_str()) != Some("gemini")
        });
    }
    if settings.get("defaultAgentId").and_then(|v| v.as_str()) == Some("gemini") {
        settings["defaultAgentId"] = serde_json::Value::Null;
    }
    if let Some(ai) = settings.get_mut("aiCommit") {
        if ai.get("agentId").and_then(|v| v.as_str()) == Some("gemini") {
            ai["agentId"] = serde_json::json!("");
            ai["model"] = serde_json::json!("");
            ai["enabled"] = serde_json::json!(false);
        }
    }
    if let Some(github) = settings.get_mut("github") {
        if github.get("aiAgentId").and_then(|v| v.as_str()) == Some("gemini") {
            github["aiAgentId"] = serde_json::Value::Null;
            github["aiModel"] = serde_json::Value::Null;
            github["aiEnabled"] = serde_json::json!(false);
        }
    }
    if let Some(providers) = settings
        .get_mut("usageProviders")
        .and_then(|v| v.as_array_mut())
    {
        providers.retain(|entry| entry.get("provider").and_then(|v| v.as_str()) != Some("gemini"));
    }
    if let Some(disabled) = settings
        .get_mut("browser")
        .and_then(|v| v.get_mut("mcpDisabledAgents"))
        .and_then(|v| v.as_array_mut())
    {
        disabled.retain(|entry| entry.as_str() != Some("gemini"));
    }
}

/// Transform a document from `from_version` to `from_version + 1`.
///
/// One arm per schema bump: each mutates the document for the next version and
/// returns it, so every migration stays independently testable and the chain in
/// [`migrate`] is just repeated application. A version with no arm is
/// unsupported rather than silently passed through.
fn migrate_step(
    from_version: u32,
    value: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    match from_version {
        1 => Ok(migrate_v1_to_v2(value)),
        _ => Err(AppError::UnsupportedVersion(from_version)),
    }
}

/// v1 → v2: stamp every repo and worktree with its execution target.
///
/// The field deserializes with a `local` default, so this transform is not what
/// makes an old document load — it is what makes the document *self-describing*,
/// and, more importantly, what the version bump buys us in the other direction:
/// a v1 binary reading a v2 document would ignore an unknown `target` field and
/// treat an SSH-hosted project as if its path were local. `migrate` refuses a
/// document newer than this binary (`version > SCHEMA_VERSION`), so that
/// misreading can never happen.
///
/// Idempotent: an existing `target` is left exactly as written.
fn migrate_v1_to_v2(mut value: serde_json::Value) -> serde_json::Value {
    const LOCAL: &str = "local";
    let Some(repos) = value.get_mut("repos").and_then(|v| v.as_array_mut()) else {
        return value;
    };
    for repo in repos.iter_mut() {
        let Some(repo) = repo.as_object_mut() else {
            continue;
        };
        repo.entry("target").or_insert_with(|| LOCAL.into());
        if let Some(worktrees) = repo.get_mut("worktrees").and_then(|v| v.as_array_mut()) {
            for wt in worktrees.iter_mut() {
                if let Some(wt) = wt.as_object_mut() {
                    wt.entry("target").or_insert_with(|| LOCAL.into());
                }
            }
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AppSettings, RepoData, Theme};

    fn temp_manager() -> (tempfile::TempDir, PersistenceManager) {
        let dir = tempfile::tempdir().unwrap();
        let mgr = PersistenceManager::new(dir.path());
        (dir, mgr)
    }

    #[test]
    fn load_missing_returns_default() {
        let (_dir, mgr) = temp_manager();
        let data = mgr.load().unwrap();
        assert_eq!(data.version, SCHEMA_VERSION);
        assert!(data.repos.is_empty());
    }

    #[test]
    fn load_removes_only_retired_gemini_cli_state() {
        let value = serde_json::json!({
            "version": SCHEMA_VERSION,
            "settings": {
                "agentProfiles": [
                    { "id": "gemini", "command": "gemini" },
                    { "id": "antigravity", "command": "agy" }
                ],
                "defaultAgentId": "gemini",
                "aiCommit": { "enabled": true, "agentId": "gemini", "model": "gemini-2.5-pro" },
                "github": { "aiEnabled": true, "aiAgentId": "gemini", "aiModel": "gemini-2.5-pro" },
                "usageProviders": [{ "provider": "gemini" }, { "provider": "grok" }],
                "browser": { "mcpDisabledAgents": ["gemini", "qwen"] }
            }
        });

        let migrated = migrate(value).unwrap();
        let settings = &migrated["settings"];
        assert_eq!(settings["agentProfiles"].as_array().unwrap().len(), 1);
        assert_eq!(settings["agentProfiles"][0]["command"], "agy");
        assert!(settings["defaultAgentId"].is_null());
        assert_eq!(settings["aiCommit"]["enabled"], false);
        assert_eq!(settings["github"]["aiEnabled"], false);
        assert_eq!(
            settings["usageProviders"],
            serde_json::json!([{ "provider": "grok" }])
        );
        assert_eq!(
            settings["browser"]["mcpDisabledAgents"],
            serde_json::json!(["qwen"])
        );
    }

    /// A v1 document: repos and worktrees written before execution targets existed.
    fn v1_document() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "repos": [{
                "id": "r1", "name": "demo", "path": "C:/code/demo",
                "worktrees": [
                    { "id": "w1", "repoId": "r1", "name": "feat", "branch": "feat",
                      "path": "C:/code/demo--feat", "createdByAde": true,
                      "createdAt": 0, "lastActivity": 0 }
                ]
            }],
            // Real defaults, not `{}`: the point of the round-trip assertion
            // below is that a migrated document deserializes as the *whole*
            // model, which a stub settings object would not.
            "settings": serde_json::to_value(AppSettings::default()).unwrap()
        })
    }

    #[test]
    fn migrate_v1_stamps_every_repo_and_worktree_as_local() {
        let migrated = migrate(v1_document()).unwrap();
        assert_eq!(migrated["version"], SCHEMA_VERSION);
        assert_eq!(migrated["repos"][0]["target"], "local");
        assert_eq!(migrated["repos"][0]["worktrees"][0]["target"], "local");

        // And the migrated document is loadable as the real model.
        let data: AppData = serde_json::from_value(migrated).unwrap();
        assert!(data.repos[0].target.is_local());
        assert!(data.repos[0].worktrees[0].target.is_local());
    }

    #[test]
    fn migrate_v1_is_idempotent_and_never_relabels_an_existing_target() {
        // A document that already carries targets (a re-run, or a partially
        // migrated file) must come out untouched — re-stamping "local" over a
        // remote target would silently move a project to the wrong machine.
        let mut doc = v1_document();
        doc["repos"][0]["target"] = serde_json::json!("ssh:h1");
        doc["repos"][0]["worktrees"][0]["target"] = serde_json::json!("ssh:h1");

        let once = migrate(doc).unwrap();
        assert_eq!(once["repos"][0]["target"], "ssh:h1");
        assert_eq!(once["repos"][0]["worktrees"][0]["target"], "ssh:h1");

        // Feeding the result back through is a no-op (it is already current).
        let twice = migrate(once.clone()).unwrap();
        assert_eq!(twice, once);
    }

    #[test]
    fn migrate_v1_tolerates_documents_with_no_repos() {
        let migrated = migrate(serde_json::json!({ "version": 1, "settings": {} })).unwrap();
        assert_eq!(migrated["version"], SCHEMA_VERSION);
    }

    #[test]
    fn a_document_newer_than_this_binary_is_refused() {
        // Why this matters for targets: a v1 binary reading a v2 document would
        // ignore the unknown `target` field and treat an SSH-hosted project as
        // local. Refusing outright is what makes that impossible.
        let err = migrate(serde_json::json!({ "version": SCHEMA_VERSION + 1 })).unwrap_err();
        assert!(matches!(err, AppError::UnsupportedVersion(_)));
    }

    #[test]
    fn save_then_load_roundtrips() {
        let (_dir, mgr) = temp_manager();
        let mut data = AppData::default();
        data.settings.theme = Theme::Dark;
        data.settings.left_sidebar_width = 321;
        data.repos.push(RepoData {
            id: "r1".into(),
            name: "demo".into(),
            path: "/tmp/demo".into(),
            target: Default::default(),
            worktrees: vec![],
            is_git: true,
            icon: None,
            branch_icons: std::collections::HashMap::new(),
            worktree_order: vec![],
            worktree_root: None,
        });
        mgr.save(&data).unwrap();

        let loaded = mgr.load().unwrap();
        assert_eq!(loaded.settings.theme, Theme::Dark);
        assert_eq!(loaded.settings.left_sidebar_width, 321);
        assert_eq!(loaded.repos.len(), 1);
        assert_eq!(loaded.repos[0].id, "r1");
    }

    #[test]
    fn save_leaves_no_temp_file_behind() {
        let (dir, mgr) = temp_manager();
        mgr.save(&AppData::default()).unwrap();
        let state = dir.path().join(STATE_FILE);
        assert!(state.exists());
        assert!(!state.with_extension("tmp").exists());
    }

    #[test]
    fn save_rotates_previous_state_into_bak_1() {
        let (dir, mgr) = temp_manager();
        let mut data = AppData::default();
        data.settings.left_sidebar_width = 100;
        mgr.save(&data).unwrap(); // first write: nothing to back up yet
        data.settings.left_sidebar_width = 200;
        mgr.save(&data).unwrap(); // rotates the 100-wide state into bak.1

        let bak1 = dir.path().join("state.bak.1");
        assert!(bak1.exists());
        let backed: AppData =
            serde_json::from_str(&std::fs::read_to_string(&bak1).unwrap()).unwrap();
        assert_eq!(backed.settings.left_sidebar_width, 100);
        assert_eq!(mgr.load().unwrap().settings.left_sidebar_width, 200);
    }

    #[test]
    fn saves_in_quick_succession_back_up_once() {
        // The ring is for recovering from a bad write, so it must hold states
        // from before a burst of saves, not five moments of the same burst.
        let (dir, mgr) = temp_manager();
        let mut data = AppData::default();
        for width in [100, 200, 300, 400, 500, 600, 700] {
            data.settings.left_sidebar_width = width;
            mgr.save(&data).unwrap();
        }
        let backed: AppData =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("state.bak.1")).unwrap())
                .unwrap();
        assert_eq!(
            backed.settings.left_sidebar_width, 100,
            "the state before the burst"
        );
        assert!(!dir.path().join("state.bak.2").exists());
        assert_eq!(mgr.load().unwrap().settings.left_sidebar_width, 700);
    }

    #[tokio::test(start_paused = true)]
    async fn save_soon_folds_a_burst_into_one_write() {
        let (_dir, mgr) = temp_manager();
        let writer = mgr.clone();
        let writes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = writes.clone();
        let task = tokio::spawn(async move {
            loop {
                writer.next_coalesced().await;
                counted.fetch_add(1, Ordering::SeqCst);
            }
        });
        for _ in 0..30 {
            mgr.save_soon();
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        tokio::time::sleep(COALESCE * 3).await;
        // 30 requests over 0.6 s: one write when the window closed.
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        assert!(!mgr.take_pending(), "nothing left once written");
        mgr.save_soon();
        assert!(mgr.take_pending(), "an exit takes what is still pending");
        task.abort();
    }

    #[test]
    fn backups_are_capped_at_max() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = PersistenceManager::with_backup_interval(dir.path(), Duration::ZERO);
        for _ in 0..(MAX_BACKUPS + 3) {
            mgr.save(&AppData::default()).unwrap();
        }
        assert!(dir.path().join(format!("state.bak.{MAX_BACKUPS}")).exists());
        assert!(!dir
            .path()
            .join(format!("state.bak.{}", MAX_BACKUPS + 1))
            .exists());
    }

    #[test]
    fn save_into_an_obstructed_data_dir_errors_instead_of_panicking() {
        // The "AppData not writable" case: the data directory cannot be created
        // because a plain file sits where it should be. The save must surface an
        // error (the UI reports it) — never panic, never write elsewhere.
        let dir = tempfile::tempdir().unwrap();
        let obstruction = dir.path().join("not-a-dir");
        std::fs::write(&obstruction, b"in the way").unwrap();
        let mgr = PersistenceManager::new(&obstruction);
        assert!(mgr.save(&AppData::default()).is_err());
        // The obstruction is untouched — nothing was clobbered trying.
        assert_eq!(std::fs::read(&obstruction).unwrap(), b"in the way");
    }

    #[test]
    fn load_of_a_corrupt_state_file_errors_instead_of_panicking() {
        // A forced close mid-write can't corrupt state.json (write-rename), but a
        // disk-level mangling still can. The load must fail cleanly; the rotating
        // backups are the recovery path.
        let (dir, mgr) = temp_manager();
        std::fs::write(dir.path().join(STATE_FILE), b"{ definitely not json").unwrap();
        assert!(mgr.load().is_err());
    }

    #[test]
    fn migrate_accepts_missing_version() {
        let value = serde_json::json!({
            "repos": [],
            "settings": AppSettings::default(),
        });
        let migrated = migrate(value).unwrap();
        assert_eq!(migrated["version"], serde_json::json!(SCHEMA_VERSION));
    }

    #[test]
    fn migrate_rejects_future_version() {
        let value = serde_json::json!({ "version": SCHEMA_VERSION + 1 });
        let err = migrate(value).unwrap_err();
        assert!(matches!(err, AppError::UnsupportedVersion(_)));
    }
}
