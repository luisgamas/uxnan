//! Minimal `which`-style command resolution, used to detect which CLI agents are
//! installed so the Settings catalog can enable only the available ones.
//!
//! Pure std (no extra dependency): walk `PATH`, and on Windows try each `PATHEXT`
//! extension — this is what makes npm shims resolve (`codex.cmd`/`codex.ps1` live
//! next to a bare `codex`, so a plain `codex` query finds `codex.cmd`).

use std::path::{Path, PathBuf};

/// Whether `command` resolves to an executable on `PATH` (or directly, if it
/// contains a path separator). Honors `PATHEXT` on Windows.
pub fn is_command_available(command: &str) -> bool {
    resolve(command).is_some()
}

/// Resolve `command` to a concrete executable path on `PATH` (or directly, if it
/// contains a path separator), honoring `PATHEXT` on Windows. `None` if not
/// found. Used to locate `node` (to run an npm CLI's entry JS) and native agent
/// binaries before spawning them shell-free.
pub fn resolve(command: &str) -> Option<PathBuf> {
    if command.trim().is_empty() {
        return None;
    }
    if command.contains('/') || command.contains('\\') {
        return resolve_with_exts(Path::new(command));
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| resolve_with_exts(&dir.join(command)))
}

/// Executable extensions to try for a bare name. On Windows this comes from
/// `PATHEXT` (with a sane default); elsewhere only the name itself is checked.
#[cfg(windows)]
fn executable_exts() -> Vec<String> {
    std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

#[cfg(not(windows))]
fn executable_exts() -> Vec<String> {
    Vec::new()
}

/// Return `base` if it is a file, else `base + ext` for the first matching
/// executable extension.
fn resolve_with_exts(base: &Path) -> Option<PathBuf> {
    if base.is_file() {
        return Some(base.to_path_buf());
    }
    for ext in executable_exts() {
        let candidate = PathBuf::from(format!("{}{}", base.display(), ext));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_command_is_unavailable() {
        assert!(!is_command_available(""));
        assert!(!is_command_available("   "));
    }

    #[test]
    fn random_command_is_unavailable() {
        assert!(!is_command_available(
            "uxnan-definitely-not-a-real-binary-xyz"
        ));
    }

    #[test]
    fn current_exe_path_is_available() {
        // An absolute path to a real file resolves via the path-separator branch.
        let exe = std::env::current_exe().unwrap();
        assert!(is_command_available(&exe.to_string_lossy()));
    }
}
