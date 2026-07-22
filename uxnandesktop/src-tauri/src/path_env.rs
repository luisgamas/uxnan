//! macOS `PATH` enrichment for GUI-launched processes.
//!
//! On macOS an app launched from Finder / Dock / Spotlight inherits `launchd`'s
//! minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) — it does **not** read the
//! user's login-shell `PATH`, so Homebrew (`/opt/homebrew/bin` on Apple Silicon,
//! `/usr/local/bin` on Intel), npm globals, node version managers and
//! `~/.local/bin` are all missing. Every CLI-agent / `gh` / `git` / editor probe
//! in this app resolves binaries against the process `PATH`
//! ([`crate::which::resolve`], `Command::new`), and PTY shells inherit it too, so
//! without help a normal Mac would report installed tools as "not installed".
//! This is the same class of problem VS Code / Electron apps solve with
//! `fix-path` / `shell-path`.
//!
//! [`enrich_for_gui_launch`] fixes it once at startup by **appending** (never
//! reordering or removing) the user's real tool directories to the process
//! `PATH`: the directories reported by the user's login+interactive shell, plus a
//! static set of well-known locations that exist on disk. It is time-bounded so a
//! slow or misbehaving shell rc can never hang app launch, and it is a **no-op on
//! every non-macOS platform** (the probe returns `None`, the well-known list is
//! empty), so Windows / Linux `PATH` is left exactly as-is.

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::path::PathBuf;
use std::time::Duration;

/// Markers wrapped around the printed `$PATH` so a login rc that echoes a banner
/// to stdout on startup can't corrupt what we parse (we read only what sits
/// between them).
const BEGIN: &str = "__UXNAN_PATH_BEGIN__";
const END: &str = "__UXNAN_PATH_END__";

/// How long to wait for the login-shell probe before giving up and falling back
/// to the well-known directories alone. Generous enough for a heavy `.zshrc`,
/// short enough that app launch never visibly stalls on a hostile one.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Enrich the current process `PATH` so a macOS GUI launch can find
/// Homebrew / npm / version-manager CLIs. Safe to call unconditionally and
/// exactly once, as early as possible at startup — before any worker thread
/// spawns or reads `PATH` (mutating the process environment is only sound while
/// the process is still single-threaded). A no-op off macOS.
pub fn enrich_for_gui_launch() {
    let base = std::env::var_os("PATH").unwrap_or_default();

    let mut additions: Vec<PathBuf> = Vec::new();
    if let Some(login_path) = login_shell_path() {
        additions.extend(std::env::split_paths(&login_path));
    }
    additions.extend(well_known_dirs());
    if additions.is_empty() {
        return;
    }

    let merged = merge_path(&base, &additions);
    if merged != base {
        // SAFE: single-threaded startup, before any child is spawned or any
        // background task reads `PATH`. Every subsequently spawned child (agent
        // CLIs, `gh`, `git`, PTY shells) inherits the enriched value.
        std::env::set_var("PATH", &merged);
    }
}

/// Append `additions` to the `base` `PATH`, preserving order and de-duplicating
/// (so a directory already present is never added twice). Base entries keep their
/// original priority — additions only ever extend the tail, so system tools
/// resolve exactly as before and user tool directories become discoverable.
fn merge_path(base: &OsStr, additions: &[PathBuf]) -> OsString {
    let mut seen: HashSet<OsString> = HashSet::new();
    let mut ordered: Vec<PathBuf> = Vec::new();
    for dir in std::env::split_paths(base) {
        if seen.insert(dir.as_os_str().to_os_string()) {
            ordered.push(dir);
        }
    }
    for dir in additions {
        if seen.insert(dir.as_os_str().to_os_string()) {
            ordered.push(dir.clone());
        }
    }
    std::env::join_paths(ordered.iter()).unwrap_or_else(|_| base.to_os_string())
}

/// Directories where user-installed CLIs commonly live but a macOS GUI launch
/// omits from `PATH`. Both Homebrew prefixes are included (`/opt/homebrew` on
/// Apple Silicon, `/usr/local` on Intel) so the same build works on either
/// architecture. Only directories that actually exist are returned, so `PATH`
/// isn't bloated with dead entries. Empty on every non-macOS platform.
fn well_known_dirs() -> Vec<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/local/sbin"),
    ];
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".npm-global").join("bin"));
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".bun").join("bin"));
        dirs.push(home.join(".deno").join("bin"));
    }
    dirs.into_iter().filter(|d| d.is_dir()).collect()
}

/// Probe the user's login **and** interactive shell for its real `PATH` — the one
/// Homebrew (`~/.zprofile`, a login file) and node version managers (`~/.zshrc`,
/// an interactive file) actually populate. Returns `None` off macOS, if the shell
/// can't be spawned, if it doesn't answer within [`PROBE_TIMEOUT`], or if the
/// output has no usable `PATH`.
fn login_shell_path() -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // `-l` sources login files (Homebrew), `-i` sources interactive files (nvm/
    // fnm/volta). The printf is wrapped in markers so rc-file banner output can't
    // corrupt the captured value.
    let script = format!("printf '{BEGIN}%s{END}' \"$PATH\"");

    let mut child = std::process::Command::new(&shell)
        .args(["-ilc", &script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    // Read stdout to EOF on a worker thread so we can enforce a hard timeout on
    // the parent: EOF arrives when the shell exits (or closes stdout). If it
    // never does, the timeout fires and we kill the child (we still own it), which
    // unblocks the reader.
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });

    let bytes = match rx.recv_timeout(PROBE_TIMEOUT) {
        Ok(bytes) => bytes,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return None;
        }
    };
    let _ = child.wait();
    let _ = reader.join();
    extract_path(&bytes)
}

/// Pull the `PATH` string from between the [`BEGIN`]/[`END`] markers in the
/// probe's stdout, ignoring any surrounding rc-file noise. `None` when the markers
/// are absent or wrap an empty value.
fn extract_path(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    let start = text.find(BEGIN)? + BEGIN.len();
    let rest = &text[start..];
    let end = rest.find(END)?;
    let path = &rest[..end];
    if path.trim().is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/// The user's home directory (`HOME`, or `USERPROFILE` as a fallback).
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_appends_new_dirs_and_dedupes() {
        let base = std::env::join_paths(["/usr/bin", "/bin"].iter().map(PathBuf::from)).unwrap();
        // One brand-new dir and one already present (must not be duplicated).
        let additions = vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/bin"),
        ];
        let merged = merge_path(&base, &additions);
        let got: Vec<PathBuf> = std::env::split_paths(&merged).collect();
        assert_eq!(
            got,
            vec![
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
                PathBuf::from("/opt/homebrew/bin"),
            ],
            "additions extend the tail; existing entries keep their order and aren't duplicated"
        );
    }

    #[test]
    fn merge_with_no_additions_is_identity() {
        let base = std::env::join_paths(["/usr/bin", "/bin"].iter().map(PathBuf::from)).unwrap();
        let merged = merge_path(&base, &[]);
        assert_eq!(merged, base);
    }

    #[test]
    fn extract_path_reads_between_markers_and_ignores_noise() {
        let out = b"Welcome to your shell\n__UXNAN_PATH_BEGIN__/opt/homebrew/bin:/usr/bin__UXNAN_PATH_END__\n";
        assert_eq!(
            extract_path(out).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[test]
    fn extract_path_none_without_markers_or_when_empty() {
        assert!(extract_path(b"no markers here").is_none());
        assert!(extract_path(b"__UXNAN_PATH_BEGIN____UXNAN_PATH_END__").is_none());
        assert!(extract_path(b"__UXNAN_PATH_BEGIN__   __UXNAN_PATH_END__").is_none());
    }

    // The enrichment only ever touches macOS; on every other platform the probe
    // is skipped and the well-known list is empty, so `PATH` is left untouched.
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn is_a_noop_off_macos() {
        assert!(well_known_dirs().is_empty());
        assert!(login_shell_path().is_none());
    }
}
