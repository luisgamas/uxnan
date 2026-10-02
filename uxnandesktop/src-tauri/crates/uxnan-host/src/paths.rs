//! Where the daemon keeps its socket and its log, on the host.
//!
//! Everything lives under `~/.uxnan/host/`, a directory only the user can read
//! (`0700`): the socket is the daemon's whole front door, and on a machine with
//! other accounts the file system's permissions are what keeps them out. The
//! socket's name carries the protocol version, so a daemon of an older version
//! keeps serving the terminals it holds while a newer one starts beside it.

use std::path::PathBuf;

use uxnan_host_protocol::PROTOCOL;

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
    run_dir().join(format!("engine-v{PROTOCOL}.sock"))
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
