//! The discovery file: how `uxnan-cli` (or anything the user runs outside the
//! app) finds the server and proves it may talk to it.
//!
//! Written once the server is up, under the app's data directory, holding the
//! **control** token — minted fresh on every start, never the per-launch token
//! the terminals get. Readable only by the user who runs the app: `0600` on
//! Unix; on Windows the file inherits the per-user profile's ACL, which is the
//! same boundary as the state file beside it. Removed on a clean exit; a
//! client also checks the pid **and** its start time, so a file left behind by
//! a crash cannot point it at a recycled pid.

use std::path::{Path, PathBuf};

use uxnan_control_protocol::discovery::{Discovery, FILE_NAME};
use uxnan_control_protocol::PROTOCOL_VERSION;

/// When this process started, as seconds since the Unix epoch. Read from the
/// OS so the client compares against the same clock; falls back to "now" when
/// the platform cannot say, which only makes a stale file look fresh for a
/// client started within the same second.
pub fn process_start_secs() -> u64 {
    let pid = sysinfo::Pid::from_u32(std::process::id());
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    system
        .process(pid)
        .map(|p| p.start_time())
        .filter(|s| *s > 0)
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        })
}

/// Write `control.json` atomically (temp + rename) under `data_dir`. Returns
/// the path, or `None` when it could not be written — the app runs on; only
/// the outside client is without a way in.
pub fn write(data_dir: &Path, origin: &str, token: &str) -> Option<PathBuf> {
    let record = Discovery {
        protocol_version: PROTOCOL_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        pid: std::process::id(),
        process_start: process_start_secs(),
        endpoint: origin.to_string(),
        token: token.to_string(),
    };
    let body = serde_json::to_vec_pretty(&record).ok()?;
    if std::fs::create_dir_all(data_dir).is_err() {
        return None;
    }
    let path = data_dir.join(FILE_NAME);
    let tmp = data_dir.join(format!(".control-{}.tmp", std::process::id()));
    if std::fs::write(&tmp, body).is_err() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).is_err() {
            let _ = std::fs::remove_file(&tmp);
            return None;
        }
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return None;
    }
    Some(path)
}

/// Remove the file on exit. Best-effort: a file that stays behind is caught by
/// the client's pid + start-time check.
pub fn remove(data_dir: &Path) {
    let _ = std::fs::remove_file(data_dir.join(FILE_NAME));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_readable_record_and_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(dir.path(), "http://127.0.0.1:4242", "tok").unwrap();
        assert_eq!(path.file_name().unwrap(), FILE_NAME);
        let record: Discovery = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(record.protocol_version, PROTOCOL_VERSION);
        assert_eq!(record.pid, std::process::id());
        assert!(record.process_start > 0);
        assert_eq!(record.endpoint, "http://127.0.0.1:4242");
        assert_eq!(record.token, "tok");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        // No temp file is left beside it.
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".control-"))
            .collect();
        assert!(leftovers.is_empty());
        remove(dir.path());
        assert!(!path.exists());
    }

    #[test]
    fn process_start_is_a_plausible_epoch() {
        // After 2020 and not in the future.
        let start = process_start_secs();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        assert!(start > 1_577_836_800, "{start}");
        assert!(start <= now + 1, "{start} > {now}");
    }
}
