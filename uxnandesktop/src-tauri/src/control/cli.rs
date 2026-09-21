//! The bundled `uxnan-cli`: where the app carries it, how every terminal the
//! app opens finds it, and the shim that puts it in the user's own shell.
//!
//! The console client ships **inside the app** as a Tauri sidecar
//! (`bundle.externalBin`, built by `scripts/build-cli.mjs` and declared by the
//! `tauri.cli.conf.json` overlay), which lands it next to the main executable
//! on every platform — `Contents/MacOS/` in the `.app`, the install folder on
//! Windows, `/usr/bin` for a deb/rpm, the mounted `usr/bin` of an AppImage, and
//! `target/debug/` under `tauri dev`. From there:
//!
//! - **Every terminal Uxnan opens gets it on the PATH** ([`terminal_env`]):
//!   the sidecar's folder is put first, and `UXNAN_CLI` names the binary
//!   outright. An agent, a worker a coordinator started, a script in that
//!   shell — none of them needs anything installed.
//! - **The user's own shell gets a shim** ([`ensure_shim`]), refreshed on
//!   every start: a symlink `~/.local/bin/uxnan-cli` on macOS and Linux (a
//!   folder most shells already have on the PATH; the guide says what to do
//!   when not), and on Windows a copy in `%LOCALAPPDATA%\uxnan\bin` with that
//!   folder added once to the user's PATH. Idempotent and best-effort: a shim
//!   that cannot be written costs nothing but the shim.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// The binary's file name.
pub const BINARY: &str = if cfg!(windows) {
    "uxnan-cli.exe"
} else {
    "uxnan-cli"
};

/// The environment variable that names the bundled binary inside a terminal
/// the app opened, for a script that would rather not rely on the PATH.
pub const ENV: &str = "UXNAN_CLI";

/// The sidecar next to the running executable, when it is there.
pub fn bundled() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let path = exe.parent()?.join(BINARY);
    path.is_file().then_some(path)
}

/// The user's home directory (`USERPROFILE` on Windows, `HOME` elsewhere).
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// The folder the shim goes in.
pub fn shim_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| home_dir().map(|h| h.join("AppData").join("Local")))
            .map(|d| d.join("uxnan").join("bin"))
    }
    #[cfg(not(windows))]
    {
        home_dir().map(|h| h.join(".local").join("bin"))
    }
}

/// The shim's path, when one is in place.
pub fn shim() -> Option<PathBuf> {
    shim_in(&shim_dir()?)
}

fn shim_in(dir: &Path) -> Option<PathBuf> {
    let path = dir.join(BINARY);
    (path.is_file() || path.is_symlink()).then_some(path)
}

/// Put the shim in place for `bundled`, or bring it up to date.
pub fn ensure_shim(bundled: &Path) -> Result<PathBuf, String> {
    let dir = shim_dir().ok_or("no home directory")?;
    ensure_shim_in(&dir, bundled)
}

fn ensure_shim_in(dir: &Path, bundled: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let link = dir.join(BINARY);
    #[cfg(unix)]
    {
        // A symlink follows the app when it updates in place, and is re-pointed
        // here when the app moved. Anything else at that path that is not our
        // link is left alone: it is the user's.
        match std::fs::read_link(&link) {
            Ok(target) if target == bundled => return Ok(link),
            Ok(_) => std::fs::remove_file(&link)
                .map_err(|e| format!("cannot replace {}: {e}", link.display()))?,
            Err(_) if link.exists() => {
                return Err(format!(
                    "{} exists and is not a link; leaving it alone",
                    link.display()
                ))
            }
            Err(_) => {}
        }
        std::os::unix::fs::symlink(bundled, &link)
            .map_err(|e| format!("cannot link {}: {e}", link.display()))?;
    }
    #[cfg(windows)]
    {
        // No symlinks without a privilege on Windows: a copy, refreshed when the
        // bundled bytes differ (an update), plus the folder on the user's PATH.
        let same = std::fs::read(&link)
            .ok()
            .zip(std::fs::read(bundled).ok())
            .is_some_and(|(a, b)| a == b);
        if !same {
            std::fs::copy(bundled, &link)
                .map_err(|e| format!("cannot copy to {}: {e}", link.display()))?;
        }
        windows_user_path::ensure(dir)?;
    }
    Ok(link)
}

/// What a terminal the app opens is given so `uxnan-cli` is at hand: the
/// sidecar's folder first on the PATH, and the binary named by [`ENV`].
pub fn terminal_env(bundled: &Path) -> Vec<(String, String)> {
    let mut env = vec![(ENV.to_string(), bundled.to_string_lossy().into_owned())];
    if let Some(dir) = bundled.parent() {
        let path = prepend_path(dir, std::env::var_os("PATH").as_deref());
        env.push(("PATH".to_string(), path.to_string_lossy().into_owned()));
    }
    env
}

/// `dir` first on `path`, unless it is already on it.
pub fn prepend_path(dir: &Path, path: Option<&OsStr>) -> OsString {
    let current = path.map(|p| p.to_os_string()).unwrap_or_default();
    if path_contains(&current, dir) {
        return current;
    }
    let mut out = OsString::from(dir);
    if !current.is_empty() {
        out.push(if cfg!(windows) { ";" } else { ":" });
        out.push(&current);
    }
    out
}

/// Whether `dir` is one of `path`'s entries (case-insensitively on Windows,
/// as the filesystem is; a trailing separator is ignored either way).
pub fn path_contains(path: &OsStr, dir: &Path) -> bool {
    let wanted = key(&dir.to_string_lossy());
    std::env::split_paths(path).any(|p| key(&p.to_string_lossy()) == wanted)
}

fn key(s: &str) -> String {
    let trimmed = s.trim_end_matches(['/', '\\']);
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

/// The user's PATH on Windows: `HKCU\Environment\Path`, plus the broadcast
/// that makes new consoles read it.
#[cfg(windows)]
mod windows_user_path {
    use std::path::Path;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_EXPAND_SZ};
    use winreg::{RegKey, RegValue};

    pub fn ensure(dir: &Path) -> Result<(), String> {
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .map_err(|e| format!("cannot open the user's environment: {e}"))?;
        let current: String = key.get_value("Path").unwrap_or_default();
        if super::path_contains(std::ffi::OsStr::new(&current), dir) {
            return Ok(());
        }
        let mut next = current.trim_end_matches(';').to_string();
        if !next.is_empty() {
            next.push(';');
        }
        next.push_str(&dir.to_string_lossy());
        // REG_EXPAND_SZ, as Windows writes it, so `%…%` entries keep expanding.
        let value = RegValue {
            vtype: REG_EXPAND_SZ,
            bytes: next
                .encode_utf16()
                .chain(std::iter::once(0))
                .flat_map(u16::to_le_bytes)
                .collect(),
        };
        key.set_raw_value("Path", &value)
            .map_err(|e| format!("cannot write the user's PATH: {e}"))?;
        broadcast();
        Ok(())
    }

    /// Tell running programs the environment changed (Explorer, and so every
    /// console opened from it, re-reads the PATH). Best-effort, bounded.
    fn broadcast() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        let env: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut result = 0usize;
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                env.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                2_000,
                &mut result,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepending_puts_the_dir_first_and_never_twice() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let dir = Path::new("/opt/uxnan");
        let once = prepend_path(dir, Some(OsStr::new("/usr/bin")));
        assert_eq!(once.to_string_lossy(), format!("/opt/uxnan{sep}/usr/bin"));
        let twice = prepend_path(dir, Some(&once));
        assert_eq!(twice, once);
        assert_eq!(prepend_path(dir, None).to_string_lossy(), "/opt/uxnan");
        assert_eq!(
            prepend_path(dir, Some(OsStr::new(""))).to_string_lossy(),
            "/opt/uxnan"
        );
    }

    #[test]
    fn membership_ignores_a_trailing_separator() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let path = OsString::from(format!("/a/b/{sep}/c"));
        assert!(path_contains(&path, Path::new("/a/b")));
        assert!(path_contains(&path, Path::new("/c/")));
        assert!(!path_contains(&path, Path::new("/a")));
    }

    #[test]
    fn a_terminal_is_told_where_the_cli_is() {
        let bundled = Path::new("/apps/Uxnan.app/Contents/MacOS/uxnan-cli");
        let env = terminal_env(bundled);
        assert_eq!(env[0].0, ENV);
        assert_eq!(env[0].1, bundled.to_string_lossy());
        let path = env.iter().find(|(k, _)| k == "PATH").unwrap();
        assert!(path.1.starts_with("/apps/Uxnan.app/Contents/MacOS"));
    }

    #[cfg(unix)]
    #[test]
    fn the_shim_is_a_link_that_follows_the_bundle_and_respects_a_stranger() {
        let home = tempfile::tempdir().unwrap();
        let bundled_a = home.path().join("A").join(BINARY);
        let bundled_b = home.path().join("B").join(BINARY);
        for b in [&bundled_a, &bundled_b] {
            std::fs::create_dir_all(b.parent().unwrap()).unwrap();
            std::fs::write(b, "#!/bin/sh\n").unwrap();
        }
        let dir = home.path().join(".local").join("bin");
        let link = ensure_shim_in(&dir, &bundled_a).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), bundled_a);
        assert_eq!(shim_in(&dir).as_deref(), Some(link.as_path()));
        // Re-pointed when the app moved.
        ensure_shim_in(&dir, &bundled_b).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), bundled_b);
        // A real file at that path is the user's: refused, untouched.
        std::fs::remove_file(&link).unwrap();
        std::fs::write(&link, "mine").unwrap();
        assert!(ensure_shim_in(&dir, &bundled_a).is_err());
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "mine");
    }
}
