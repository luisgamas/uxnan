//! The builds of the engine on this host, and removing the ones nothing runs.
//!
//! Every build the desktop uploads gets its own folder under
//! `~/.uxnan/host/versions/` (named by version and content), so an update never
//! replaces the program a running daemon was started from. That leaves the old
//! ones behind, and only this side can tell which are still in use: every
//! process started from a build — the daemon, and each `attach` while its
//! connection lasts — holds a shared lock on that folder's `.in-use` file for
//! as long as it runs. A daemon that starts removes every other folder nobody
//! holds, once it is old enough that it cannot be an upload about to be run.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// A folder younger than this is left alone: the desktop may have just
/// uploaded it and be about to run it.
pub const MIN_AGE: Duration = Duration::from_secs(10 * 60);

const IN_USE: &str = ".in-use";

/// The lock that says "a process runs from this build". Released when dropped
/// — or when the process ends, however it ends.
pub struct InUse {
    _file: File,
}

/// The folder the running binary was started from, if it is one of ours.
fn own_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    (dir.parent()? == versions_dir()).then_some(dir)
}

fn versions_dir() -> PathBuf {
    crate::paths::home().join("versions")
}

/// Mark this process's build as in use, for as long as the returned guard
/// lives. `None` when the binary is not one of the uploaded builds (a
/// developer running it from a checkout), which nothing would sweep anyway.
pub fn hold() -> Option<InUse> {
    let dir = own_dir()?;
    let file = lock_file(&dir)?;
    lock(&file, false).then_some(InUse { _file: file })
}

/// Remove every build folder but this process's own that nobody runs from
/// and that is older than `min_age`. Answers what was removed.
pub fn sweep(min_age: Duration) -> Vec<String> {
    let own = own_dir();
    let Ok(entries) = std::fs::read_dir(versions_dir()) else {
        return Vec::new();
    };
    let mut removed = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() || Some(&dir) == own.as_ref() {
            continue;
        }
        let old_enough = std::fs::metadata(&dir)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age >= min_age);
        if !old_enough {
            continue;
        }
        // Exclusive and non-blocking: it succeeds only if no process holds
        // the shared lock, and while it is held nothing new can take it.
        let Some(file) = lock_file(&dir) else {
            continue;
        };
        if !lock(&file, true) {
            continue;
        }
        if std::fs::remove_dir_all(&dir).is_ok() {
            removed.push(entry.file_name().to_string_lossy().into_owned());
        }
        drop(file);
    }
    removed
}

fn lock_file(dir: &Path) -> Option<File> {
    std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(IN_USE))
        .ok()
}

#[cfg(unix)]
fn lock(file: &File, exclusive: bool) -> bool {
    use std::os::unix::io::AsRawFd;
    let mode = if exclusive {
        libc::LOCK_EX | libc::LOCK_NB
    } else {
        libc::LOCK_SH
    };
    // SAFETY: flock on a descriptor this function borrows for the call.
    unsafe { libc::flock(file.as_raw_fd(), mode) == 0 }
}

#[cfg(not(unix))]
fn lock(_file: &File, exclusive: bool) -> bool {
    // No advisory locks here yet: nothing is ever judged unused.
    !exclusive
}
