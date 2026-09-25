//! The bridge's single-instance lock (`~/.uxnan/bridge.lock`, written by
//! `bridge/src/lock-file.ts`), read — never written — to tell "no bridge is
//! running" from "a bridge is running but serves no local channel".
//!
//! The second case is real: a bridge released before the local channel
//! existed (or one started with `localControlEnabled: false`) holds the lock and
//! the LAN port but never writes `local-control.json`. Without this read, the
//! desktop reported it as "not running", and `managed` mode kept starting a
//! second bridge that exited at once on the held lock.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

/// File name under the bridge's state directory (`DaemonState` → `lock`).
pub const FILE_NAME: &str = "bridge.lock";

/// A bridge younger than this may still be about to write its discovery file.
pub const STARTING_GRACE: Duration = Duration::from_secs(10);

/// A lock file is a few dozen bytes; anything past this is not one.
const MAX_FILE_BYTES: u64 = 4 * 1024;

/// What the lock says about the bridge holding it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockInfo {
    pub pid: u32,
    /// Epoch milliseconds.
    pub started_at: u64,
}

/// `~/.uxnan/bridge.lock`.
pub fn default_path() -> Option<PathBuf> {
    Some(
        crate::agent_hooks::home_dir()?
            .join(".uxnan")
            .join(FILE_NAME),
    )
}

/// Parses a lock file's contents; `None` for anything that is not one.
pub fn parse(raw: &str) -> Option<LockInfo> {
    let info: LockInfo = serde_json::from_str(raw).ok()?;
    (info.pid != 0).then_some(info)
}

/// The bridge holding the lock at `path`, when its process is alive. A stale
/// lock (its process gone) is no bridge at all — the bridge itself takes such
/// a lock over on its next start.
pub fn running(path: &Path) -> Option<LockInfo> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let info = parse(&std::fs::read_to_string(path).ok()?)?;
    pid_alive(info.pid).then_some(info)
}

/// Whether the bridge holding `info` started less than [`STARTING_GRACE`] ago
/// (by `now_ms`), so its discovery file may simply not be written yet.
pub fn just_started(info: &LockInfo, now_ms: u64) -> bool {
    now_ms.saturating_sub(info.started_at) < STARTING_GRACE.as_millis() as u64
}

fn pid_alive(pid: u32) -> bool {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let pid = Pid::from_u32(pid);
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing(),
    );
    sys.process(pid).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_bridge_lock_and_rejects_anything_else() {
        assert_eq!(
            parse(r#"{"pid":65786,"startedAt":1790294040896}"#),
            Some(LockInfo {
                pid: 65786,
                started_at: 1_790_294_040_896
            })
        );
        assert_eq!(parse(r#"{"pid":0,"startedAt":1}"#), None);
        assert_eq!(parse("not json"), None);
        assert_eq!(parse(r#"{"pid":"x"}"#), None);
    }

    #[test]
    fn a_lock_held_by_a_live_process_is_a_running_bridge() {
        let path = std::env::temp_dir().join(format!("uxnan-lock-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(
            &path,
            format!(r#"{{"pid":{},"startedAt":1}}"#, std::process::id()),
        )
        .unwrap();
        assert_eq!(running(&path).map(|i| i.pid), Some(std::process::id()));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_stale_or_missing_lock_is_no_bridge() {
        let path = std::env::temp_dir().join(format!("uxnan-lock-{}.json", uuid::Uuid::new_v4()));
        assert_eq!(running(&path), None);
        // A pid far above any real one: no such process.
        std::fs::write(&path, r#"{"pid":4294967000,"startedAt":1}"#).unwrap();
        assert_eq!(running(&path), None);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_bridge_is_starting_for_a_short_grace_only() {
        let info = LockInfo {
            pid: 1,
            started_at: 100_000,
        };
        assert!(just_started(&info, 100_000 + 2_000));
        assert!(!just_started(&info, 100_000 + 60_000));
    }
}
