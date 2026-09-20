//! Where the app keeps its data, computed without the app: for a process that
//! has no Tauri handle (the console client, the headless automation runner)
//! and must find the same directory the app resolves with
//! `app.path().app_data_dir()`.
//!
//! Three rules, in order: the `UXNAN_DATA_DIR` override when set to an absolute
//! path; otherwise the platform's per-user data directory joined with the app
//! identifier; and, for a development build, the `-dev` sibling of that, so a
//! dev build and the installed app never share a profile.

use std::path::{Path, PathBuf};

/// The app's bundle identifier — the last path segment of its data directory.
pub const APP_IDENTIFIER: &str = "dev.luisgamas.uxnandesktop";

/// Environment variable that relocates the application data directory.
pub const DATA_DIR_ENV: &str = "UXNAN_DATA_DIR";

/// Suffix a development build appends to the profile directory.
pub const DEV_SUFFIX: &str = "-dev";

/// The override, if one is set and usable. `None` when unset, empty, or
/// relative — a relative path would resolve against whatever the working
/// directory happened to be, so the same command could point at two profiles.
pub fn override_dir() -> Option<PathBuf> {
    parse_override(std::env::var_os(DATA_DIR_ENV).as_deref().map(Path::new))
}

/// Pure half of [`override_dir`].
pub fn parse_override(raw: Option<&Path>) -> Option<PathBuf> {
    let raw = raw?;
    if raw.as_os_str().is_empty() || !raw.is_absolute() {
        return None;
    }
    Some(raw.to_path_buf())
}

/// The platform's per-user data directory for the app, from the environment:
/// `%APPDATA%\<id>` on Windows, `~/Library/Application Support/<id>` on macOS,
/// `$XDG_DATA_HOME/<id>` (or `~/.local/share/<id>`) elsewhere. `None` when the
/// environment does not say where home is.
pub fn platform_default() -> Option<PathBuf> {
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

    base.map(|b| b.join(APP_IDENTIFIER))
}

/// `<dir>` → `<dir>-dev`, beside the real profile rather than inside it.
pub fn dev_profile(dir: PathBuf) -> PathBuf {
    let Some(name) = dir.file_name().map(|n| n.to_string_lossy().into_owned()) else {
        return dir;
    };
    dir.with_file_name(format!("{name}{DEV_SUFFIX}"))
}

/// The directory a process built with `debug` (or not) should use: the
/// override, else the platform default, `-dev`-suffixed for a debug build.
pub fn resolve(debug: bool) -> Option<PathBuf> {
    if let Some(dir) = override_dir() {
        return Some(dir);
    }
    let default = platform_default()?;
    Some(if debug { dev_profile(default) } else { default })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_override_must_be_absolute_and_non_empty() {
        assert!(parse_override(None).is_none());
        assert!(parse_override(Some(Path::new(""))).is_none());
        assert!(parse_override(Some(Path::new("relative/profile"))).is_none());
        let abs = if cfg!(windows) { "C:\\p" } else { "/p" };
        assert_eq!(
            parse_override(Some(Path::new(abs))),
            Some(PathBuf::from(abs))
        );
    }

    #[test]
    fn a_dev_profile_sits_beside_the_real_one() {
        assert_eq!(
            dev_profile(PathBuf::from("/data/dev.luisgamas.uxnandesktop")),
            PathBuf::from("/data/dev.luisgamas.uxnandesktop-dev")
        );
    }

    #[test]
    fn the_platform_default_ends_with_the_identifier() {
        if let Some(dir) = platform_default() {
            assert_eq!(dir.file_name().unwrap(), APP_IDENTIFIER);
        }
    }
}
