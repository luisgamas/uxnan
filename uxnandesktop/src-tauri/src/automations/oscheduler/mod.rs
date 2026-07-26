//! Registration with the operating system's own scheduler.
//!
//! This is what makes an automation fire **with uxnan closed**: the app never
//! keeps a clock of its own, it hands the schedule to Task Scheduler (Windows),
//! launchd (macOS) or a systemd user timer (Linux), which then spawns the
//! headless runner ([`super::runner`]) at the right moment.
//!
//! Three properties this buys us that an in-app timer cannot:
//!
//! * it keeps working while the app is closed (the entire point),
//! * the OS recovers a run whose moment passed while the machine was off
//!   (`StartWhenAvailable` / `Persistent`), and
//! * the OS enforces the "don't pile up" rule itself
//!   (`MultipleInstancesPolicy`), so our overlap policy has a real backstop
//!   rather than only the runner's own check.
//!
//! Everything here registers **per user and without elevation**.
//!
//! # Structure
//!
//! Each platform module splits into a **pure builder** (always compiled, always
//! unit-tested — the XML / plist / unit text is where the bugs live) and the
//! **invocation** that shells out, which is `cfg`-gated. That way the Windows
//! CI machine still tests the macOS plist and the systemd units.
//!
//! # Honest degradation
//!
//! Registration can legitimately fail: an unsupported platform, a corporate
//! policy, a locked-down machine. When it does, the automation is **not**
//! broken — the app keeps firing it while it is open — but the UI must say so.
//! [`SchedulerStatus`] is what it says it with; nothing here ever pretends a
//! task is registered when it isn't.

pub mod linux;
pub mod macos;
pub mod windows;

use serde::{Deserialize, Serialize};

use super::Automation;
use crate::error::AppError;

/// Whether the OS scheduler currently owns this automation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SchedulerStatus {
    /// The task exists and the OS will fire it.
    Registered,
    /// No task exists (the automation is disabled, or was never registered).
    Absent,
    /// This platform has no integration, so the automation only runs while the
    /// app is open. Never reported as an error — it is a known limitation.
    Unsupported,
    /// Registration or the query itself failed. Carries the reason **verbatim**
    /// so the UI can show the user what the OS actually said.
    Failed { message: String },
}

/// The identifier the OS knows an automation by. Namespaced so uxnan's tasks are
/// obvious in Task Scheduler / `launchctl list` / `systemctl --user`, and easy
/// to clean up by hand.
pub fn task_name(automation_id: &str) -> String {
    format!("uxnan-automation-{automation_id}")
}

/// Whether this build can talk to an OS scheduler at all.
pub const fn is_supported() -> bool {
    cfg!(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "linux"
    ))
}

/// Path of the running executable, which is what the OS will spawn. Resolved
/// once per call rather than cached, so a moved or updated install re-registers
/// against the right binary.
pub fn current_exe() -> Result<String, AppError> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| AppError::Invalid(format!("could not resolve the uxnan executable: {e}")))
}

/// The arguments the OS passes to the runner.
pub fn run_args(automation_id: &str) -> Vec<String> {
    vec![
        "--automation-run".to_string(),
        automation_id.to_string(),
        "--trigger".to_string(),
        "scheduled".to_string(),
    ]
}

/// Register (or replace) `automation` with the OS scheduler.
///
/// `start_boundary` is a **local** ISO 8601 datetime (`YYYY-MM-DDTHH:MM:SS`)
/// supplied by the caller. The backend deliberately does no calendar
/// arithmetic — the frontend owns local-time math (see [`super::schedule`]) —
/// and every platform wants the first occurrence expressed in local time.
pub async fn register(automation: &Automation, start_boundary: &str) -> SchedulerStatus {
    if !automation.enabled {
        // A disabled automation must not hold a live task; treat a register call
        // on one as "make sure it is gone".
        return unregister(&automation.id).await;
    }
    match register_inner(automation, start_boundary).await {
        Ok(status) => status,
        Err(e) => SchedulerStatus::Failed {
            message: e.to_string(),
        },
    }
}

/// Remove the automation's task. Succeeds when there was nothing to remove.
pub async fn unregister(automation_id: &str) -> SchedulerStatus {
    match unregister_inner(automation_id).await {
        Ok(status) => status,
        Err(e) => SchedulerStatus::Failed {
            message: e.to_string(),
        },
    }
}

/// What the OS currently thinks about this automation.
pub async fn status(automation_id: &str) -> SchedulerStatus {
    match status_inner(automation_id).await {
        Ok(status) => status,
        Err(e) => SchedulerStatus::Failed {
            message: e.to_string(),
        },
    }
}

#[cfg(target_os = "windows")]
async fn register_inner(
    automation: &Automation,
    start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    windows::register(automation, start_boundary).await
}
#[cfg(target_os = "macos")]
async fn register_inner(
    automation: &Automation,
    start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    macos::register(automation, start_boundary).await
}
#[cfg(all(unix, not(target_os = "macos")))]
async fn register_inner(
    automation: &Automation,
    start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    linux::register(automation, start_boundary).await
}

#[cfg(target_os = "windows")]
async fn unregister_inner(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    windows::unregister(automation_id).await
}
#[cfg(target_os = "macos")]
async fn unregister_inner(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    macos::unregister(automation_id).await
}
#[cfg(all(unix, not(target_os = "macos")))]
async fn unregister_inner(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    linux::unregister(automation_id).await
}

#[cfg(target_os = "windows")]
async fn status_inner(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    windows::status(automation_id).await
}
#[cfg(target_os = "macos")]
async fn status_inner(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    macos::status(automation_id).await
}
#[cfg(all(unix, not(target_os = "macos")))]
async fn status_inner(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    linux::status(automation_id).await
}

/// Format a repeat interval as an ISO 8601 duration, the shape Task Scheduler
/// and systemd both accept. Weeks become days because Task Scheduler's
/// repetition interval has no week unit.
pub fn iso_duration(seconds: u64) -> String {
    if seconds % 86_400 == 0 {
        format!("P{}D", seconds / 86_400)
    } else if seconds % 3_600 == 0 {
        format!("PT{}H", seconds / 3_600)
    } else {
        format!("PT{}M", seconds.div_ceil(60))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_names_are_namespaced_and_traceable() {
        // A user poking around Task Scheduler must be able to tell whose task
        // this is and which automation it belongs to.
        let name = task_name("6f1c2b3a");
        assert!(name.starts_with("uxnan-automation-"));
        assert!(name.ends_with("6f1c2b3a"));
    }

    #[test]
    fn run_args_target_the_headless_runner_as_a_scheduled_run() {
        assert_eq!(
            run_args("a1"),
            vec!["--automation-run", "a1", "--trigger", "scheduled"]
        );
    }

    #[test]
    fn iso_durations_pick_the_coarsest_exact_unit() {
        assert_eq!(iso_duration(60), "PT1M");
        assert_eq!(iso_duration(15 * 60), "PT15M");
        assert_eq!(iso_duration(3_600), "PT1H");
        assert_eq!(iso_duration(2 * 3_600), "PT2H");
        assert_eq!(iso_duration(86_400), "P1D");
        // A week has no unit of its own in Task Scheduler's repetition.
        assert_eq!(iso_duration(7 * 86_400), "P7D");
        // A non-round value still yields something valid rather than nonsense.
        assert_eq!(iso_duration(90), "PT2M");
    }

    #[test]
    fn a_failed_status_carries_the_reason_verbatim() {
        // The UI has to be able to show what the OS actually said, not a
        // sanitized "something went wrong".
        let s = SchedulerStatus::Failed {
            message: "Access is denied.".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"kind\":\"failed\""), "{json}");
        assert!(json.contains("Access is denied."), "{json}");
    }
}
