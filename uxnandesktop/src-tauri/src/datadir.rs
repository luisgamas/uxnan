//! Where the ADE keeps its state on disk, and the one way to move it.
//!
//! Everything the app persists — `state.json` + its backups, the terminal
//! scrollback sidecar, `hooks/`, `pets/`, `automations/` — hangs off a single
//! per-user directory: `app.path().app_data_dir()` inside the app, and the
//! hand-rolled equivalent in [`crate::automations::store::app_data_dir`] for the
//! headless runner, which has no Tauri handle at all.
//!
//! [`UXNAN_DATA_DIR`](DATA_DIR_ENV) overrides that directory for the whole
//! process. It exists so a run of the app can be given a **disposable profile**:
//! the resource benchmarks (`scripts/resources/`) seed a scenario's projects and
//! terminal layout into a temp directory and launch the release binary against
//! it, which is both what makes a scenario reproducible and what keeps the
//! harness from ever writing into the real profile. The same override is what a
//! future E2E driver needs to start from a known state.
//!
//! It is deliberately inert in normal use: one `env::var_os` at startup, no
//! effect on anything measured. A relative path is **refused** (it would resolve
//! against whatever the working directory happened to be, so the same command
//! could point at two different profiles) — the app then falls back to the
//! platform location rather than persisting somewhere surprising.

use std::path::{Path, PathBuf};

/// Environment variable that relocates the application data directory.
pub const DATA_DIR_ENV: &str = "UXNAN_DATA_DIR";

/// The override, if one is set and usable. `None` when unset, empty, or
/// relative.
pub fn override_dir() -> Option<PathBuf> {
    parse_override(std::env::var_os(DATA_DIR_ENV).as_deref().map(Path::new))
}

/// The directory the app should use: the override when it is usable, else the
/// platform default the caller resolved.
pub fn resolve(platform_default: PathBuf) -> PathBuf {
    override_dir().unwrap_or(platform_default)
}

/// Pure half of [`override_dir`], so the rules are testable without touching
/// the process environment.
fn parse_override(raw: Option<&Path>) -> Option<PathBuf> {
    let path = raw?;
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return None;
    }
    Some(path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_means_no_override() {
        assert_eq!(parse_override(None), None);
    }

    #[test]
    fn empty_is_ignored() {
        assert_eq!(parse_override(Some(Path::new(""))), None);
    }

    #[test]
    fn relative_is_refused() {
        // Resolving against the working directory would make the same command
        // mean different profiles, so the platform default wins instead.
        assert_eq!(parse_override(Some(Path::new("profile"))), None);
        assert_eq!(parse_override(Some(Path::new("./profile"))), None);
        assert_eq!(parse_override(Some(Path::new("../profile"))), None);
    }

    #[test]
    fn absolute_is_taken_as_is() {
        #[cfg(windows)]
        let raw = Path::new(r"C:\tmp\uxnan-bench\data");
        #[cfg(not(windows))]
        let raw = Path::new("/tmp/uxnan-bench/data");

        assert_eq!(parse_override(Some(raw)), Some(raw.to_path_buf()));
    }

    #[test]
    fn resolve_falls_back_to_the_platform_default() {
        // No override is set in the test process, so the caller's own path wins.
        let fallback = PathBuf::from(if cfg!(windows) {
            r"C:\Users\example\AppData\Roaming\dev.luisgamas.uxnandesktop"
        } else {
            "/home/example/.local/share/dev.luisgamas.uxnandesktop"
        });
        assert_eq!(resolve(fallback.clone()), fallback);
    }
}
