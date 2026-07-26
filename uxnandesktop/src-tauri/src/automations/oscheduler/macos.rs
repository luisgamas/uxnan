//! macOS launchd integration (LaunchAgent, per user, no elevation).
//!
//! A LaunchAgent in `~/Library/LaunchAgents` is loaded for the logged-in user
//! and is the standard way to schedule user-level work on macOS. `launchd`
//! gives us the catch-up behaviour for free: a `StartCalendarInterval` job whose
//! moment passed while the machine was asleep or off fires once at wake.
//!
//! The plist builder is a pure function compiled on every platform, so its shape
//! is unit-tested even on the Windows machines this repo is mostly developed on.
//!
//! **Not validated on real hardware yet** — see `FOR-DEV.md`.

use super::{run_args, task_name, SchedulerStatus};
use crate::automations::{Automation, Schedule};
use crate::error::AppError;

/// Reverse-DNS label launchd knows the job by, matching the app's bundle id.
pub fn label(automation_id: &str) -> String {
    format!("dev.luisgamas.uxnandesktop.automation.{automation_id}")
}

/// File name of the agent's plist.
pub fn plist_file_name(automation_id: &str) -> String {
    format!("{}.plist", label(automation_id))
}

/// Escape text for a plist `<string>`.
fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The scheduling keys for a schedule.
///
/// An interval maps to `StartInterval` (seconds). The clock-time presets map to
/// `StartCalendarInterval`, which is what keeps them pinned to the wall clock —
/// and, unlike an interval, is what launchd will catch up after a sleep.
fn schedule_keys(schedule: &Schedule) -> String {
    let cal = |body: &str| format!("  <key>StartCalendarInterval</key>\n{body}");
    match schedule {
        Schedule::Every { .. } => {
            let seconds = schedule.interval_seconds().unwrap_or(3_600);
            format!("  <key>StartInterval</key>\n  <integer>{seconds}</integer>\n")
        }
        Schedule::DailyAt { hour, minute } => cal(&format!(
            "  <dict>\n    <key>Hour</key>\n    <integer>{hour}</integer>\n    <key>Minute</key>\n    <integer>{minute}</integer>\n  </dict>\n"
        )),
        Schedule::WeekdaysAt { hour, minute } => {
            // launchd has no "weekdays" concept: it is five calendar entries.
            let entries: String = (1..=5)
                .map(|d| {
                    format!(
                        "    <dict>\n      <key>Weekday</key>\n      <integer>{d}</integer>\n      <key>Hour</key>\n      <integer>{hour}</integer>\n      <key>Minute</key>\n      <integer>{minute}</integer>\n    </dict>\n"
                    )
                })
                .collect();
            cal(&format!("  <array>\n{entries}  </array>\n"))
        }
        Schedule::WeeklyAt { day, hour, minute } => cal(&format!(
            "  <dict>\n    <key>Weekday</key>\n    <integer>{day}</integer>\n    <key>Hour</key>\n    <integer>{hour}</integer>\n    <key>Minute</key>\n    <integer>{minute}</integer>\n  </dict>\n"
        )),
    }
}

/// The complete LaunchAgent document.
pub fn build_plist(automation: &Automation, exe: &str) -> String {
    let args: String = std::iter::once(exe.to_string())
        .chain(run_args(&automation.id))
        .map(|a| format!("    <string>{}</string>\n", esc(&a)))
        .collect();

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
{args}  </array>
{schedule}  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
"#,
        label = esc(&label(&automation.id)),
        args = args,
        schedule = schedule_keys(&automation.schedule),
    )
}

#[cfg(target_os = "macos")]
fn agents_dir() -> Result<std::path::PathBuf, AppError> {
    let home = crate::agent_hooks::home_dir()
        .ok_or_else(|| AppError::NotFound("could not resolve the home directory".into()))?;
    Ok(home.join("Library").join("LaunchAgents"))
}

#[cfg(target_os = "macos")]
async fn launchctl(args: &[&str]) -> Result<std::process::Output, AppError> {
    use std::process::Stdio;
    crate::winproc::command("launchctl")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Invalid(format!("launchctl failed: {e}")))
}

/// launchd addresses a user's domain as `gui/<uid>`.
///
/// The uid comes from `id -u` rather than a libc binding: it costs one cheap
/// subprocess on an operation that happens when an automation is saved, and it
/// keeps this module free of both a new dependency and an `unsafe` block.
#[cfg(target_os = "macos")]
async fn gui_domain() -> Result<String, AppError> {
    use std::process::Stdio;
    let out = crate::winproc::command("id")
        .arg("-u")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Invalid(format!("could not resolve the user id: {e}")))?;
    let uid = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if uid.is_empty() || !uid.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Invalid("could not resolve the user id".into()));
    }
    Ok(format!("gui/{uid}"))
}

#[cfg(target_os = "macos")]
pub async fn register(
    automation: &Automation,
    _start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    let exe = super::current_exe()?;
    let dir = agents_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(plist_file_name(&automation.id));
    std::fs::write(&path, build_plist(automation, &exe))?;

    // Replace any previous definition: bootout first (ignoring "not loaded"),
    // then bootstrap the new plist.
    let domain = gui_domain().await?;
    let _ = launchctl(&["bootout", &format!("{domain}/{}", label(&automation.id))]).await;
    let out = launchctl(&["bootstrap", &domain, &path.to_string_lossy()]).await?;
    if out.status.success() {
        Ok(SchedulerStatus::Registered)
    } else {
        Ok(SchedulerStatus::Failed {
            message: first_line(&out.stderr, &out.stdout),
        })
    }
}

#[cfg(target_os = "macos")]
pub async fn unregister(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    let domain = gui_domain().await?;
    // Unloading something that isn't loaded is the desired end state.
    let _ = launchctl(&["bootout", &format!("{domain}/{}", label(automation_id))]).await;
    let path = agents_dir()?.join(plist_file_name(automation_id));
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(SchedulerStatus::Absent)
}

#[cfg(target_os = "macos")]
pub async fn status(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    let out = launchctl(&["list", &label(automation_id)]).await?;
    if out.status.success() {
        Ok(SchedulerStatus::Registered)
    } else {
        Ok(SchedulerStatus::Absent)
    }
}

#[cfg(target_os = "macos")]
fn first_line(stderr: &[u8], stdout: &[u8]) -> String {
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(stderr),
        String::from_utf8_lossy(stdout)
    );
    combined
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("launchctl failed")
        .to_string()
}

#[cfg(not(target_os = "macos"))]
pub async fn register(
    _automation: &Automation,
    _start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
}
#[cfg(not(target_os = "macos"))]
pub async fn unregister(_automation_id: &str) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
}
#[cfg(not(target_os = "macos"))]
pub async fn status(_automation_id: &str) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
}

/// Silence the unused-import warning for the shared helper on platforms whose
/// invocation half is compiled out.
#[allow(dead_code)]
fn _uses_task_name(id: &str) -> String {
    task_name(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automations::{OnFailure, Policy, Step, TimeUnit};

    fn automation(schedule: Schedule) -> Automation {
        Automation {
            id: "a1".into(),
            name: "Nightly triage".into(),
            description: String::new(),
            icon: None,
            enabled: true,
            tags: vec![],
            working_dir: "/work".into(),
            worktree_per_run: false,
            base_branch: None,
            schedule,
            policy: Policy::default(),
            steps: vec![Step {
                id: "s1".into(),
                title: "Scan".into(),
                agent: "claude".into(),
                model: String::new(),
                prompt: "go".into(),
                depends_on: vec![],
                on_failure: OnFailure::Stop,
                max_attempts: 1,
                timeout_ms: None,
                autonomous: false,
            }],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn the_label_matches_the_bundle_identifier() {
        assert_eq!(label("a1"), "dev.luisgamas.uxnandesktop.automation.a1");
        assert!(plist_file_name("a1").ends_with(".plist"));
    }

    #[test]
    fn an_interval_becomes_start_interval_seconds() {
        let plist = build_plist(
            &automation(Schedule::Every {
                n: 15,
                unit: TimeUnit::Minutes,
                starts_at: 0,
            }),
            "/Applications/uxnan.app/Contents/MacOS/uxnan",
        );
        assert!(plist.contains("<key>StartInterval</key>"), "{plist}");
        assert!(plist.contains("<integer>900</integer>"), "{plist}");
        assert!(!plist.contains("StartCalendarInterval"));
    }

    #[test]
    fn clock_presets_become_calendar_entries() {
        let daily = build_plist(&automation(Schedule::DailyAt { hour: 9, minute: 5 }), "/u");
        assert!(daily.contains("<key>StartCalendarInterval</key>"));
        assert!(
            daily.contains("<key>Hour</key>\n    <integer>9</integer>"),
            "{daily}"
        );
        assert!(daily.contains("<key>Minute</key>\n    <integer>5</integer>"));
        assert!(!daily.contains("Weekday"));

        let weekly = build_plist(
            &automation(Schedule::WeeklyAt {
                day: 3,
                hour: 18,
                minute: 30,
            }),
            "/u",
        );
        assert!(
            weekly.contains("<key>Weekday</key>\n    <integer>3</integer>"),
            "{weekly}"
        );
    }

    #[test]
    fn weekdays_expand_to_five_calendar_entries() {
        // launchd has no "weekdays" concept, so this must not silently become
        // a single entry that only fires on one day.
        let plist = build_plist(
            &automation(Schedule::WeekdaysAt { hour: 7, minute: 0 }),
            "/u",
        );
        assert!(plist.contains("<array>"), "{plist}");
        for day in 1..=5 {
            assert!(
                plist.contains(&format!(
                    "<key>Weekday</key>\n      <integer>{day}</integer>"
                )),
                "missing weekday {day}: {plist}"
            );
        }
        // Check the weekday keys specifically: a bare `<integer>0</integer>`
        // also matches the schedule's own minute, which would make this pass
        // for the wrong reason.
        for weekend in [0u8, 6] {
            assert!(
                !plist.contains(&format!(
                    "<key>Weekday</key>\n      <integer>{weekend}</integer>"
                )),
                "weekday {weekend} must not be scheduled: {plist}"
            );
        }
        assert_eq!(plist.matches("<key>Weekday</key>").count(), 5);
    }

    #[test]
    fn the_runner_arguments_are_passed_as_separate_strings() {
        // launchd does not run a shell, so the arguments must be a real argv
        // array — a single joined string would be treated as one argument.
        let plist = build_plist(
            &automation(Schedule::DailyAt { hour: 1, minute: 0 }),
            "/usr/bin/uxnan",
        );
        assert!(plist.contains("<string>/usr/bin/uxnan</string>"), "{plist}");
        assert!(plist.contains("<string>--automation-run</string>"));
        assert!(plist.contains("<string>a1</string>"));
        assert!(plist.contains("<string>scheduled</string>"));
    }

    #[test]
    fn it_never_runs_just_because_the_agent_loaded() {
        // RunAtLoad would fire the automation at every login, which is not what
        // any of our schedules mean.
        let plist = build_plist(&automation(Schedule::DailyAt { hour: 1, minute: 0 }), "/u");
        assert!(
            plist.contains("<key>RunAtLoad</key>\n  <false/>"),
            "{plist}"
        );
    }

    #[test]
    fn hostile_text_cannot_break_the_document() {
        let plist = build_plist(
            &automation(Schedule::DailyAt { hour: 1, minute: 0 }),
            "/a&b/<u>",
        );
        assert!(plist.contains("/a&amp;b/&lt;u&gt;"), "{plist}");
    }
}
