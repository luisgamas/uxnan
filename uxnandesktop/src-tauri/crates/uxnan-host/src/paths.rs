//! Where the daemon keeps its socket and its log, on the host.
//!
//! Everything lives under `~/.uxnan/host/`, a directory only the user can read
//! (`0700`): the socket is the daemon's whole front door, and on a machine with
//! other accounts the file system's permissions are what keeps them out.
//!
//! **One socket, whatever the version.** A newer app reaches the daemon that
//! holds the host's terminals — of whichever build — and the two meet in their
//! protocol window; the newer daemon takes over only once the older one has
//! nothing left to do and exits. A socket per version would have the newer app
//! start a daemon beside the old one and never see the terminals it holds,
//! which is exactly what an update must not do.

use std::path::PathBuf;

/// `UXNAN_HOST_HOME` overrides the location — for tests, which must never
/// touch the real one.
pub fn home() -> PathBuf {
    if let Some(dir) = std::env::var_os("UXNAN_HOST_HOME") {
        return PathBuf::from(dir);
    }
    let base = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(".uxnan").join("host")
}

pub fn run_dir() -> PathBuf {
    home().join("run")
}

pub fn socket() -> PathBuf {
    run_dir().join("engine.sock")
}

/// On Windows the daemon's channel is a named pipe rather than a socket file:
/// one per account and engine home (a test's private home never meets the
/// real daemon), whatever the version — for the same reason there is one
/// socket.
#[cfg(windows)]
pub fn pipe_name() -> String {
    // FNV-1a over the home folder: stable, short, and no crate for it.
    let key = home().to_string_lossy().to_lowercase();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!(r"\\.\pipe\uxnan-host-{hash:016x}")
}

pub fn log() -> PathBuf {
    home().join("host.log")
}

/// Create `dir` (and its parents) readable by the user alone.
pub fn ensure_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
