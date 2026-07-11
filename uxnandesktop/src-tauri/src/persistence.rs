//! Crash-safe JSON persistence for [`AppData`].
//!
//! Writes use the **write-rename** pattern: serialize to `<file>.tmp`, then
//! `rename` it over the target. `rename` is atomic on every supported OS, so an
//! interrupted write can never leave a half-written `state.json` — the previous
//! good copy stays intact.
//!
//! Before each write the current file is rotated into a ring of **5 numbered
//! backups** (`state.bak.1` … `state.bak.5`), so a bad migration or a corrupt
//! write can be recovered from a recent snapshot. Loading applies forward schema
//! migrations in sequence (see [`migrate`]).
//!
//! A debounced async writer (coalesce rapid saves) is still a follow-up; the
//! frontend already debounces the high-frequency layout writes. See `FOR-DEV.md`.

use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::model::{AppData, SCHEMA_VERSION};

/// File name of the persisted state document inside the app data directory.
const STATE_FILE: &str = "state.json";

/// Number of rotating backups kept alongside `state.json` (spec §7).
const MAX_BACKUPS: usize = 5;

/// Owns the on-disk location of the ADE's persisted state and performs the
/// atomic load/save.
#[derive(Debug, Clone)]
pub struct PersistenceManager {
    path: PathBuf,
}

impl PersistenceManager {
    /// Build a manager rooted at `data_dir` (typically `app_data_dir()`).
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self {
            path: data_dir.as_ref().join(STATE_FILE),
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

    /// Persist `data` atomically (rotate backups → write temp → rename over
    /// target). Backup rotation is best-effort: a failed snapshot never blocks
    /// the actual save.
    pub fn save(&self, data: &AppData) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(data)?;
        self.rotate_backups();
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, json.as_bytes())?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Rotate the current `state.json` into the backup ring before it is
    /// overwritten: `bak.4→bak.5` (oldest dropped), …, `bak.1→bak.2`, then the
    /// live file is copied to `bak.1`. Best-effort — errors are ignored so a
    /// backup problem can't stop the save.
    fn rotate_backups(&self) {
        for i in (1..MAX_BACKUPS).rev() {
            let from = self.path.with_extension(format!("bak.{i}"));
            if from.exists() {
                let to = self.path.with_extension(format!("bak.{}", i + 1));
                let _ = std::fs::rename(&from, &to);
            }
        }
        if self.path.exists() {
            let _ = std::fs::copy(&self.path, self.path.with_extension("bak.1"));
        }
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
    Ok(value)
}

/// Transform a document from `from_version` to `from_version + 1`.
///
// FOR-DEV: add an arm per schema bump as the model evolves, e.g.
//   1 => Ok(migrate_v1_to_v2(value)),
// Each arm mutates the document for the next version and returns it. Until the
// first bump there are no arms, so any sub-current version is unsupported.
fn migrate_step(
    from_version: u32,
    _value: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    Err(AppError::UnsupportedVersion(from_version))
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
    fn save_then_load_roundtrips() {
        let (_dir, mgr) = temp_manager();
        let mut data = AppData::default();
        data.settings.theme = Theme::Dark;
        data.settings.left_sidebar_width = 321;
        data.repos.push(RepoData {
            id: "r1".into(),
            name: "demo".into(),
            path: "/tmp/demo".into(),
            worktrees: vec![],
            is_git: true,
            icon: None,
            branch_icons: std::collections::HashMap::new(),
            worktree_order: vec![],
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
    fn backups_are_capped_at_max() {
        let (dir, mgr) = temp_manager();
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
