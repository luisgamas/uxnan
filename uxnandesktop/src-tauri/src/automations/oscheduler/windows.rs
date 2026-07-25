//! Windows Task Scheduler integration.
//!
//! We register a full **Task Scheduler XML** document rather than using
//! `schtasks`' short flags, because the flags cannot express the four things
//! that actually matter here:
//!
//! * `Hidden` — a scheduled run must not flash a window in the user's face,
//! * `MultipleInstancesPolicy` — this *is* the overlap policy, enforced by the
//!   OS instead of only by our runner,
//! * `ExecutionTimeLimit` — a backstop for a run that hangs past its ceiling,
//! * `StartWhenAvailable` — recovery of a run whose moment passed while the
//!   machine was off.
//!
//! The XML builder is a pure function so its exact shape (element order is
//! schema-significant) is unit-tested on every platform, not discovered on a
//! user's machine.
//!
//! **Caveat, documented rather than papered over:** the task runs with
//! `InteractiveToken`, i.e. only while the user is logged on. Running with the
//! user logged off would mean storing their password, which we will not do.

use super::{iso_duration, run_args, task_name, SchedulerStatus};
use crate::automations::{Automation, Overlap, Schedule};
use crate::error::AppError;

/// Escape text for an XML text node / attribute value.
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Task Scheduler's `MultipleInstancesPolicy` for our overlap rule. The OS
/// enforcing this is what keeps runs from piling up even if the app never gets
/// a chance to look.
const fn instances_policy(overlap: Overlap) -> &'static str {
    match overlap {
        Overlap::Skip => "IgnoreNew",
        Overlap::Queue => "Queue",
        Overlap::CancelPrevious => "StopExisting",
    }
}

/// `<DaysOfWeek>` children for a weekday index (0 = Sunday).
const fn weekday_element(day: u8) -> &'static str {
    match day {
        0 => "Sunday",
        1 => "Monday",
        2 => "Tuesday",
        3 => "Wednesday",
        4 => "Thursday",
        5 => "Friday",
        _ => "Saturday",
    }
}

/// The `<Triggers>` body for a schedule.
///
/// An interval becomes a `TimeTrigger` with a `Repetition`; the clock-time
/// presets become a `CalendarTrigger`, which stays pinned to the wall clock
/// across DST where a plain interval would drift.
fn build_triggers(schedule: &Schedule, start_boundary: &str) -> String {
    let sb = esc(start_boundary);
    match schedule {
        Schedule::Every { .. } => {
            let interval = iso_duration(schedule.interval_seconds().unwrap_or(3_600));
            format!(
                "    <TimeTrigger>\n      <Repetition>\n        <Interval>{interval}</Interval>\n        <StopAtDurationEnd>false</StopAtDurationEnd>\n      </Repetition>\n      <StartBoundary>{sb}</StartBoundary>\n      <Enabled>true</Enabled>\n    </TimeTrigger>\n"
            )
        }
        Schedule::DailyAt { .. } => format!(
            "    <CalendarTrigger>\n      <StartBoundary>{sb}</StartBoundary>\n      <Enabled>true</Enabled>\n      <ScheduleByDay>\n        <DaysInterval>1</DaysInterval>\n      </ScheduleByDay>\n    </CalendarTrigger>\n"
        ),
        Schedule::WeekdaysAt { .. } => format!(
            "    <CalendarTrigger>\n      <StartBoundary>{sb}</StartBoundary>\n      <Enabled>true</Enabled>\n      <ScheduleByWeek>\n        <DaysOfWeek>\n          <Monday />\n          <Tuesday />\n          <Wednesday />\n          <Thursday />\n          <Friday />\n        </DaysOfWeek>\n        <WeeksInterval>1</WeeksInterval>\n      </ScheduleByWeek>\n    </CalendarTrigger>\n"
        ),
        Schedule::WeeklyAt { day, .. } => {
            let d = weekday_element(*day);
            format!(
                "    <CalendarTrigger>\n      <StartBoundary>{sb}</StartBoundary>\n      <Enabled>true</Enabled>\n      <ScheduleByWeek>\n        <DaysOfWeek>\n          <{d} />\n        </DaysOfWeek>\n        <WeeksInterval>1</WeeksInterval>\n      </ScheduleByWeek>\n    </CalendarTrigger>\n"
            )
        }
    }
}

/// The complete task document. Element order follows what Task Scheduler itself
/// exports, because the schema is a sequence and a reordered document is
/// rejected as malformed.
pub fn build_task_xml(automation: &Automation, exe: &str, start_boundary: &str) -> String {
    let description = if automation.description.trim().is_empty() {
        format!("uxnan automation: {}", automation.name)
    } else {
        automation.description.clone()
    };
    let args = run_args(&automation.id).join(" ");
    let limit = iso_duration(u64::from(automation.policy.max_run_minutes) * 60);

    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>{description}</Description>
    <URI>\{uri}</URI>
  </RegistrationInfo>
  <Triggers>
{triggers}  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>{instances}</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>{catch_up}</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>{limit}</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{command}</Command>
      <Arguments>{arguments}</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        description = esc(&description),
        uri = esc(&task_name(&automation.id)),
        triggers = build_triggers(&automation.schedule, start_boundary),
        instances = instances_policy(automation.policy.overlap),
        catch_up = automation.policy.catch_up,
        limit = limit,
        command = esc(exe),
        arguments = esc(&args),
    )
}

/// Task Scheduler reads the XML as Unicode, so the file must be UTF-16 LE with
/// a BOM. Handing it UTF-8 fails with a bare "malformed XML" that says nothing
/// about the real cause.
pub fn to_utf16_bytes(xml: &str) -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xFE];
    for unit in xml.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

#[cfg(target_os = "windows")]
pub async fn register(
    automation: &Automation,
    start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    use std::process::Stdio;

    let exe = super::current_exe()?;
    let xml = build_task_xml(automation, &exe, start_boundary);
    let name = task_name(&automation.id);

    let path = std::env::temp_dir().join(format!("{name}.xml"));
    std::fs::write(&path, to_utf16_bytes(&xml))?;

    let output = crate::winproc::command("schtasks")
        .args(["/Create", "/TN", &name, "/XML"])
        .arg(&path)
        .arg("/F")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    // The temp document is never interesting after the call, and leaving task
    // definitions lying around in %TEMP% would be untidy at best.
    let _ = std::fs::remove_file(&path);

    let output = output?;
    if output.status.success() {
        Ok(SchedulerStatus::Registered)
    } else {
        Ok(SchedulerStatus::Failed {
            message: schtasks_message(&output.stdout, &output.stderr),
        })
    }
}

#[cfg(target_os = "windows")]
pub async fn unregister(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    use std::process::Stdio;

    let name = task_name(automation_id);
    let output = crate::winproc::command("schtasks")
        .args(["/Delete", "/TN", &name, "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if output.status.success() {
        return Ok(SchedulerStatus::Absent);
    }
    // Deleting something that isn't there is the desired end state, not a
    // failure — unregister must be idempotent. Rather than guess from the
    // error text, ask what the end state actually is.
    match status(automation_id).await? {
        SchedulerStatus::Absent => Ok(SchedulerStatus::Absent),
        _ => Ok(SchedulerStatus::Failed {
            message: schtasks_message(&output.stdout, &output.stderr),
        }),
    }
}

#[cfg(target_os = "windows")]
pub async fn status(automation_id: &str) -> Result<SchedulerStatus, AppError> {
    use std::process::Stdio;

    let name = task_name(automation_id);
    let output = crate::winproc::command("schtasks")
        .args(["/Query", "/TN", &name])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if output.status.success() {
        return Ok(SchedulerStatus::Registered);
    }

    // The query failed. Two very different causes look identical in the exit
    // code — the task simply isn't there, or `schtasks` can't run at all (a
    // locked-down machine, a policy). Telling them apart by matching the error
    // text is a trap: the message is localized, so "cannot find" never matches
    // on a Spanish, German or Japanese Windows and every task would report as a
    // failure. Instead, probe whether `schtasks` works at all.
    let probe = crate::winproc::command("schtasks")
        .args(["/Query", "/FO", "CSV", "/NH"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if probe.status.success() {
        // schtasks is healthy, so the specific task genuinely isn't registered.
        Ok(SchedulerStatus::Absent)
    } else {
        // We cannot see the task store at all — the user has to know that,
        // rather than being told forever that nothing is registered.
        Ok(SchedulerStatus::Failed {
            message: schtasks_message(&probe.stdout, &probe.stderr),
        })
    }
}

/// The most useful line `schtasks` printed, for a [`SchedulerStatus::Failed`].
#[cfg(target_os = "windows")]
fn schtasks_message(stdout: &[u8], stderr: &[u8]) -> String {
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(stderr),
        String::from_utf8_lossy(stdout)
    );
    combined
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("schtasks failed")
        .to_string()
}

#[cfg(not(target_os = "windows"))]
pub async fn register(
    _automation: &Automation,
    _start_boundary: &str,
) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
}
#[cfg(not(target_os = "windows"))]
pub async fn unregister(_automation_id: &str) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
}
#[cfg(not(target_os = "windows"))]
pub async fn status(_automation_id: &str) -> Result<SchedulerStatus, AppError> {
    Ok(SchedulerStatus::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automations::{Policy, Step, TimeUnit};

    fn automation(schedule: Schedule) -> Automation {
        Automation {
            id: "a1".into(),
            name: "Nightly triage".into(),
            description: String::new(),
            icon: None,
            enabled: true,
            tags: vec![],
            working_dir: "C:/work".into(),
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
                on_failure: crate::automations::OnFailure::Stop,
                max_attempts: 1,
                timeout_ms: None,
            }],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn an_interval_becomes_a_repeating_time_trigger() {
        let a = automation(Schedule::Every {
            n: 15,
            unit: TimeUnit::Minutes,
            starts_at: 0,
        });
        let xml = build_task_xml(&a, r"C:\Apps\uxnan-desktop.exe", "2026-07-25T09:00:00");
        assert!(xml.contains("<TimeTrigger>"), "{xml}");
        assert!(xml.contains("<Interval>PT15M</Interval>"), "{xml}");
        assert!(xml.contains("<StartBoundary>2026-07-25T09:00:00</StartBoundary>"));
        assert!(!xml.contains("<CalendarTrigger>"));
    }

    #[test]
    fn clock_presets_become_calendar_triggers() {
        // A wall-clock schedule must not be expressed as an interval, or it
        // drifts off the hour across DST.
        let daily = build_task_xml(
            &automation(Schedule::DailyAt { hour: 9, minute: 0 }),
            "uxnan.exe",
            "2026-07-25T09:00:00",
        );
        assert!(daily.contains("<ScheduleByDay>"), "{daily}");
        assert!(!daily.contains("<Repetition>"));

        let weekdays = build_task_xml(
            &automation(Schedule::WeekdaysAt { hour: 9, minute: 0 }),
            "uxnan.exe",
            "2026-07-25T09:00:00",
        );
        assert!(weekdays.contains("<Monday />") && weekdays.contains("<Friday />"));
        assert!(!weekdays.contains("<Saturday />") && !weekdays.contains("<Sunday />"));

        let weekly = build_task_xml(
            &automation(Schedule::WeeklyAt {
                day: 3,
                hour: 18,
                minute: 30,
            }),
            "uxnan.exe",
            "2026-07-25T18:30:00",
        );
        assert!(weekly.contains("<Wednesday />"), "{weekly}");
        assert!(!weekly.contains("<Monday />"));
    }

    #[test]
    fn the_overlap_policy_is_delegated_to_the_os() {
        let mut a = automation(Schedule::DailyAt { hour: 1, minute: 0 });
        a.policy.overlap = Overlap::Skip;
        assert!(build_task_xml(&a, "u.exe", "2026-07-25T01:00:00")
            .contains("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>"));
        a.policy.overlap = Overlap::Queue;
        assert!(build_task_xml(&a, "u.exe", "2026-07-25T01:00:00")
            .contains("<MultipleInstancesPolicy>Queue</MultipleInstancesPolicy>"));
        a.policy.overlap = Overlap::CancelPrevious;
        assert!(build_task_xml(&a, "u.exe", "2026-07-25T01:00:00")
            .contains("<MultipleInstancesPolicy>StopExisting</MultipleInstancesPolicy>"));
    }

    #[test]
    fn catch_up_and_the_time_ceiling_reach_the_task() {
        let mut a = automation(Schedule::DailyAt { hour: 1, minute: 0 });
        a.policy.catch_up = true;
        a.policy.max_run_minutes = 90;
        let xml = build_task_xml(&a, "u.exe", "2026-07-25T01:00:00");
        assert!(xml.contains("<StartWhenAvailable>true</StartWhenAvailable>"));
        assert!(
            xml.contains("<ExecutionTimeLimit>PT90M</ExecutionTimeLimit>"),
            "{xml}"
        );

        a.policy.catch_up = false;
        assert!(build_task_xml(&a, "u.exe", "2026-07-25T01:00:00")
            .contains("<StartWhenAvailable>false</StartWhenAvailable>"));
    }

    #[test]
    fn the_task_runs_hidden_and_targets_the_headless_runner() {
        let a = automation(Schedule::DailyAt { hour: 1, minute: 0 });
        let xml = build_task_xml(
            &a,
            r"C:\Program Files\uxnan\uxnan-desktop.exe",
            "2026-07-25T01:00:00",
        );
        assert!(
            xml.contains("<Hidden>true</Hidden>"),
            "a scheduled run must not flash a window"
        );
        assert!(
            xml.contains(r"<Command>C:\Program Files\uxnan\uxnan-desktop.exe</Command>"),
            "{xml}"
        );
        assert!(
            xml.contains("<Arguments>--automation-run a1 --trigger scheduled</Arguments>"),
            "{xml}"
        );
    }

    #[test]
    fn hostile_text_cannot_break_the_document() {
        // A name is free-form user input and lands in an XML text node.
        let mut a = automation(Schedule::DailyAt { hour: 1, minute: 0 });
        a.description = r#"Tom & Jerry's <script>"quotes"</script>"#.into();
        let xml = build_task_xml(&a, r"C:\a&b\uxnan.exe", "2026-07-25T01:00:00");
        assert!(
            xml.contains("Tom &amp; Jerry&apos;s &lt;script&gt;"),
            "{xml}"
        );
        assert!(!xml.contains("<script>"));
        assert!(xml.contains(r"C:\a&amp;b\uxnan.exe"));
    }

    #[test]
    fn the_document_is_utf16_with_a_bom() {
        // Task Scheduler rejects a UTF-8 document with an unhelpful
        // "malformed XML", so the encoding is part of the contract.
        let bytes = to_utf16_bytes("<Task/>");
        assert_eq!(&bytes[..2], &[0xFF, 0xFE], "missing UTF-16 LE BOM");
        assert_eq!(bytes[2], b'<');
        assert_eq!(bytes[3], 0);
    }

    /// Round-trip against the **real** Task Scheduler: register, query, delete.
    ///
    /// `#[ignore]`d so it never runs in CI or on a normal `cargo test` — it
    /// touches the machine's actual task store. Run it deliberately on a Windows
    /// box with `cargo test -- --ignored windows_round_trip`. This is the only
    /// way to catch the failure this module is most exposed to: Task Scheduler
    /// rejecting the document (element order, encoding) with a message that says
    /// nothing about the real cause.
    #[tokio::test]
    #[ignore = "touches the machine's real Task Scheduler; run explicitly"]
    #[cfg(target_os = "windows")]
    async fn windows_round_trip_against_the_real_scheduler() {
        let mut a = automation(Schedule::Every {
            n: 15,
            unit: TimeUnit::Minutes,
            starts_at: 0,
        });
        a.id = "selftest-roundtrip".into();
        a.name = "uxnan self-test".into();

        // Start from a clean slate in case a previous run was interrupted.
        let _ = unregister(&a.id).await;

        let registered = register(&a, "2026-01-01T03:00:00").await.unwrap();
        assert_eq!(
            registered,
            SchedulerStatus::Registered,
            "Task Scheduler refused the document"
        );
        assert_eq!(status(&a.id).await.unwrap(), SchedulerStatus::Registered);

        assert_eq!(unregister(&a.id).await.unwrap(), SchedulerStatus::Absent);
        assert_eq!(
            status(&a.id).await.unwrap(),
            SchedulerStatus::Absent,
            "the task outlived its removal"
        );
        // Removing it twice must stay quiet.
        assert_eq!(unregister(&a.id).await.unwrap(), SchedulerStatus::Absent);
    }

    #[test]
    fn a_missing_description_falls_back_to_the_name() {
        let a = automation(Schedule::DailyAt { hour: 1, minute: 0 });
        assert!(build_task_xml(&a, "u.exe", "2026-07-25T01:00:00")
            .contains("<Description>uxnan automation: Nightly triage</Description>"));
    }
}
