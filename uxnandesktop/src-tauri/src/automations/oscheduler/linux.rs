//! Linux systemd **user** timer integration (no root, no system units).
//!
//! A pair of units in `~/.config/systemd/user` — a `oneshot` service that runs
//! the headless runner, and a timer that triggers it. `Persistent=true` on a
//! calendar timer is systemd's equivalent of "catch up a run the machine slept
//! through".
//!
//! The unit builders are pure functions compiled on every platform, so their
//! text is unit-tested even where systemd doesn't exist.
//!
//! **Not validated on real hardware yet** — see `FOR-DEV.md`.

use super::{run_args, task_name, SchedulerStatus};
use crate::automations::{Automation, Schedule};
use crate::error::AppError;

/// Base unit name (without the `.service` / `.timer` suffix).
pub fn unit_name(automation_id: &str) -> String {
    task_name(automation_id)
}

/// systemd expands `%` in unit files, and a unit description is a single line.
fn sanitize(s: &str) -> String {
    s.replace('%', "%%")
        .replace(['\n', '\r'], " ")
        .trim()
        .to_string()
}

/// Quote an `ExecStart` argument so a path with spaces survives.
fn quote(arg: &str) -> String {
    format!("\"{}\"", arg.replace('\\', "\\\\").replace('"', "\\\""))
}

/// systemd's weekday abbreviation for our index (0 = Sunday).
const fn weekday_abbrev(day: u8) -> &'static str {
    match day {
        0 => "Sun",
        1 => "Mon",
        2 => "Tue",
        3 => "Wed",
        4 => "Thu",
        5 => "Fri",
        _ => "Sat",
    }
}

/// The `oneshot` service unit that runs one execution.
pub fn build_service_unit(automation: &Automation, exe: &str) -> String {
    let args: Vec<String> = run_args(&automation.id).iter().map(|a| quote(a)).collect();
    format!(
        "[Unit]\nDescription=uxnan automation: {name}\n\n[Service]\nType=oneshot\nExecStart={exec} {args}\n",
        name = sanitize(&automation.name),
        exec = quote(exe),
        args = args.join(" "),
    )
}

/// The timer unit. An interval uses a monotonic timer; the clock-time presets
/// use `OnCalendar`, which is both wall-clock accurate and the only form
/// `Persistent=` (catch-up) applies to.
pub fn build_timer_unit(automation: &Automation) -> String {
    let unit = unit_name(&automation.id);
    let body = match &automation.schedule {
        Schedule::Every { .. } => {
            let seconds = automation.schedule.interval_seconds().unwrap_or(3_600);
            // OnBootSec gives the first run after a boot; OnUnitActiveSec paces
            // the rest. Persistent= has no meaning for a monotonic timer, so it
            // is deliberately absent rather than set and silently ignored.
            format!("OnBootSec=1min\nOnUnitActiveSec={seconds}s\n")
        }
        Schedule::DailyAt { hour, minute } => {
            format!(
                "OnCalendar=*-*-* {hour:02}:{minute:02}:00\n{persistent}",
                persistent = persistent_line(automation)
            )
        }
        Schedule::WeekdaysAt { hour, minute } => format!(
            "OnCalendar=Mon..Fri *-*-* {hour:02}:{minute:02}:00\n{persistent}",
            persistent = persistent_line(automation)
        ),
        Schedule::WeeklyAt { day, hour, minute } => format!(
            "OnCalendar={d} *-*-* {hour:02}:{minute:02}:00\n{persistent}",
            d = weekday_abbrev(*day),
            persistent = persistent_line(automation)
        ),
    };
    format!(
        "[Unit]\nDescription=Schedule for uxnan automation: {name}\n\n[Timer]\n{body}AccuracySec=30s\nUnit={unit}.service\n\n[Install]\nWantedBy=timers.target\n",
        name = sanitize(&automation.name),
    )
}

fn persistent_line(automation: &Automation) -> String {
    if automation.policy.catch_up {
        "Persistent=true\n".to_string()
    } else {
        String::new()
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn units_dir() -> Result<std::path::PathBuf, AppError> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| crate::agent_hooks::home_dir().map(|h| h.join(".config")))
        .ok_or_else(|| AppError::NotFound("could not resolve the config directory".into()))?;
    Ok(base.join("systemd").join("user"))
}

#[cfg(all(unix, not(target_os = "macos")))]
async fn systemctl(args: &[&str]) -> Result<std::process::Output, AppError> {
    use std::process::Stdio;
    crate::winproc::command("systemctl")
        .arg("--user")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Invalid(format!("systemctl failed: {e}")))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub async fn register(
    automation: &Automation,
    _start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    let exe = super::current_exe()?;
    let dir = units_dir()?;
    std::fs::create_dir_all(&dir)?;
    let unit = unit_name(&automation.id);
    std::fs::write(
        dir.join(format!("{unit}.service")),
        build_service_unit(automation, &exe),
    )?;
    std::fs::write(
        dir.join(format!("{unit}.timer")),
        build_timer_unit(automation),
    )?;

    let _ = systemctl(&["daemon-reload"]).await;
    let out = systemctl(&["enable", "--now", &format!("{unit}.timer")]).await?;
    if out.status.success() {
        Ok(SchedulerStatus::Registered)
    } else {
        Ok(SchedulerStatus::Failed {
            message: first_line(&out.stderr, &out.stdout),
        })
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub async fn unregister(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    let unit = unit_name(automation_id);
    // Disabling a timer that isn't there is the desired end state.
    let _ = systemctl(&["disable", "--now", &format!("{unit}.timer")]).await;
    if let Ok(dir) = units_dir() {
        let _ = std::fs::remove_file(dir.join(format!("{unit}.timer")));
        let _ = std::fs::remove_file(dir.join(format!("{unit}.service")));
    }
    let _ = systemctl(&["daemon-reload"]).await;
    Ok(SchedulerStatus::Absent)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub async fn status(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    let out = systemctl(&["is-enabled", &format!("{}.timer", unit_name(automation_id))]).await?;
    if out.status.success() {
        Ok(SchedulerStatus::Registered)
    } else {
        Ok(SchedulerStatus::Absent)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
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
        .unwrap_or("systemctl failed")
        .to_string()
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
pub async fn register(
    _automation: &Automation,
    _start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
}
#[cfg(not(all(unix, not(target_os = "macos"))))]
pub async fn unregister(_automation_id: &str) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
}
#[cfg(not(all(unix, not(target_os = "macos"))))]
pub async fn status(_automation_id: &str) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
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
            }],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn the_service_runs_the_headless_runner_once() {
        let unit = build_service_unit(
            &automation(Schedule::DailyAt { hour: 9, minute: 0 }),
            "/opt/uxnan/uxnan desktop",
        );
        assert!(unit.contains("Type=oneshot"), "{unit}");
        // A path with a space must survive as one argument.
        assert!(
            unit.contains(r#"ExecStart="/opt/uxnan/uxnan desktop" "--automation-run" "a1""#),
            "{unit}"
        );
        assert!(unit.contains(r#""--trigger" "scheduled""#));
    }

    #[test]
    fn an_interval_uses_a_monotonic_timer() {
        let unit = build_timer_unit(&automation(Schedule::Every {
            n: 15,
            unit: TimeUnit::Minutes,
            starts_at: 0,
        }));
        assert!(unit.contains("OnUnitActiveSec=900s"), "{unit}");
        assert!(unit.contains("OnBootSec=1min"));
        // Persistent= is meaningless for a monotonic timer; setting it would be
        // a lie about catch-up behaviour.
        assert!(!unit.contains("Persistent="), "{unit}");
    }

    #[test]
    fn clock_presets_use_oncalendar_with_catch_up() {
        let daily = build_timer_unit(&automation(Schedule::DailyAt { hour: 9, minute: 5 }));
        assert!(daily.contains("OnCalendar=*-*-* 09:05:00"), "{daily}");
        assert!(
            daily.contains("Persistent=true"),
            "catch-up must be requested"
        );

        let weekdays = build_timer_unit(&automation(Schedule::WeekdaysAt { hour: 7, minute: 0 }));
        assert!(
            weekdays.contains("OnCalendar=Mon..Fri *-*-* 07:00:00"),
            "{weekdays}"
        );

        let weekly = build_timer_unit(&automation(Schedule::WeeklyAt {
            day: 3,
            hour: 18,
            minute: 30,
        }));
        assert!(weekly.contains("OnCalendar=Wed *-*-* 18:30:00"), "{weekly}");
    }

    #[test]
    fn catch_up_off_drops_the_persistent_line() {
        let mut a = automation(Schedule::DailyAt { hour: 9, minute: 0 });
        a.policy.catch_up = false;
        assert!(!build_timer_unit(&a).contains("Persistent="));
    }

    #[test]
    fn the_timer_points_at_its_own_service_and_installs() {
        let unit = build_timer_unit(&automation(Schedule::DailyAt { hour: 1, minute: 0 }));
        assert!(unit.contains("Unit=uxnan-automation-a1.service"), "{unit}");
        assert!(unit.contains("WantedBy=timers.target"));
    }

    #[test]
    fn a_percent_in_a_name_is_escaped_and_newlines_collapse() {
        // systemd expands % specifiers, and a Description is a single line.
        let mut a = automation(Schedule::DailyAt { hour: 1, minute: 0 });
        a.name = "100% done\nreally".into();
        let unit = build_timer_unit(&a);
        assert!(
            unit.contains("Description=Schedule for uxnan automation: 100%% done really"),
            "{unit}"
        );
        assert_eq!(unit.matches("Description=").count(), 1);
    }
}
