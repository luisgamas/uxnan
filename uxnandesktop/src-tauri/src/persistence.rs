//! Crash-safe JSON persistence for [`AppData`].
//!
//! Writes use the **write-rename** pattern: serialize to `<file>.tmp`, then
//! `rename` it over the target. `rename` is atomic on every supported OS, so an
//! interrupted write can never leave a half-written `state.json` — the previous
//! good copy stays intact.
//!
//! Rotating backups and a debounced async writer are Phase 5 robustness items;
//! see `FOR-DEV.md`. This module deliberately keeps Phase 0 minimal but correct.

use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::model::{AppData, SCHEMA_VERSION};

/// File name of the persisted state document inside the app data directory.
const STATE_FILE: &str = "state.json";

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

    /// Persist `data` atomically (write temp → rename over target).
    pub fn save(&self, data: &AppData) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(data)?;
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, json.as_bytes())?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

/// Apply sequential schema migrations until the JSON matches [`SCHEMA_VERSION`].
///
/// Phase 0 only knows version 1: a document already at the current version (or
/// with no `version` field — treated as current) passes through; a newer
/// version is rejected so an older binary never silently corrupts future data.
///
// FOR-DEV: add `v if v == 1 => migrate_v1_to_v2(value)?` style arms here as the
// schema evolves (see `architecture/03-implementation-guide.md` §2.4).
fn migrate(mut value: serde_json::Value) -> Result<serde_json::Value, AppError> {
    let version = value
        .get("version")
        .and_then(|v| v.as_u64())
        .unwrap_or(SCHEMA_VERSION as u64) as u32;

    match version {
        v if v == SCHEMA_VERSION => {
            if value.get("version").is_none() {
                if let Some(obj) = value.as_object_mut() {
                    obj.insert("version".into(), serde_json::json!(SCHEMA_VERSION));
                }
            }
            Ok(value)
        }
        v => Err(AppError::UnsupportedVersion(v)),
    }
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
