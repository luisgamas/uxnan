//! How often an automation repeats.
//!
//! **This module deliberately does no calendar arithmetic.** The OS scheduler
//! (Task Scheduler / launchd / systemd timer) owns *when* a run fires — it is
//! the component that must keep firing while uxnan is closed, so making it the
//! single authority removes a whole class of drift. Rust only has to describe a
//! schedule well enough to emit the OS trigger and to log it; the "next 5 runs"
//! preview in the UI is display-only and computed in the frontend, where JS
//! `Date` gives local-time calendar math for free.
//!
//! There is no one-shot variant on purpose: an automation is a *recurring*,
//! unattended task. A single ad-hoc execution belongs to the three-panel
//! workflow, not here.

use serde::{Deserialize, Serialize};

/// The unit of an [`Schedule::Every`] interval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimeUnit {
    Minutes,
    Hours,
    Days,
    Weeks,
}

impl TimeUnit {
    /// The interval in whole seconds — the common currency every OS scheduler
    /// speaks (Task Scheduler `Repetition/Interval`, launchd `StartInterval`,
    /// systemd `OnUnitActiveSec`).
    pub const fn seconds(self) -> u64 {
        match self {
            TimeUnit::Minutes => 60,
            TimeUnit::Hours => 3_600,
            TimeUnit::Days => 86_400,
            TimeUnit::Weeks => 604_800,
        }
    }

    /// Lowercase English label used in logs and run records.
    pub const fn label(self) -> &'static str {
        match self {
            TimeUnit::Minutes => "minutes",
            TimeUnit::Hours => "hours",
            TimeUnit::Days => "days",
            TimeUnit::Weeks => "weeks",
        }
    }
}

/// Smallest interval we accept, in seconds. A sub-minute automation would spawn
/// agent CLIs faster than they can finish and is almost always a mistake.
pub const MIN_INTERVAL_SECONDS: u64 = 60;

/// When an automation repeats. `Every` is the free-form interval the user asked
/// for ("cada N minutos/horas/días/semanas"); the other three are the clock-time
/// presets, which map to a *calendar* trigger on every OS rather than a plain
/// interval (so they stay pinned to the wall clock across DST).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Schedule {
    /// Every `n` `unit`s, counted from `starts_at` (epoch ms).
    Every {
        n: u32,
        unit: TimeUnit,
        starts_at: i64,
    },
    /// Every day at `hour`:`minute` (local time).
    DailyAt { hour: u8, minute: u8 },
    /// Monday–Friday at `hour`:`minute` (local time).
    WeekdaysAt { hour: u8, minute: u8 },
    /// Weekly on `day` (0 = Sunday … 6 = Saturday) at `hour`:`minute`.
    WeeklyAt { day: u8, hour: u8, minute: u8 },
}

impl Schedule {
    /// Reject a schedule that could never work, with a message meant for a log
    /// or a run record. The frontend validates the same rules for immediate
    /// feedback; this is the backstop that also guards a hand-edited file.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Schedule::Every { n, unit, .. } => {
                if *n == 0 {
                    return Err("the interval must be at least 1".into());
                }
                let seconds = u64::from(*n) * unit.seconds();
                if seconds < MIN_INTERVAL_SECONDS {
                    return Err(format!(
                        "the interval must be at least {MIN_INTERVAL_SECONDS} seconds"
                    ));
                }
                Ok(())
            }
            Schedule::DailyAt { hour, minute } | Schedule::WeekdaysAt { hour, minute } => {
                check_clock(*hour, *minute)
            }
            Schedule::WeeklyAt { day, hour, minute } => {
                if *day > 6 {
                    return Err("the weekday must be between 0 (Sunday) and 6".into());
                }
                check_clock(*hour, *minute)
            }
        }
    }

    /// A plain-English one-liner for logs and run records. The UI renders its own
    /// localized label from the same data — this never reaches a screen.
    pub fn describe(&self) -> String {
        match self {
            Schedule::Every { n, unit, .. } => format!("every {n} {}", unit.label()),
            Schedule::DailyAt { hour, minute } => format!("daily at {hour:02}:{minute:02}"),
            Schedule::WeekdaysAt { hour, minute } => {
                format!("weekdays at {hour:02}:{minute:02}")
            }
            Schedule::WeeklyAt { day, hour, minute } => {
                format!("weekly on {} at {hour:02}:{minute:02}", weekday_name(*day))
            }
        }
    }

    /// The repeat interval in seconds, for the schedulers that take one
    /// directly. `None` for the clock-time presets, which must be emitted as a
    /// calendar trigger instead (an interval would drift off the wall clock).
    pub fn interval_seconds(&self) -> Option<u64> {
        match self {
            Schedule::Every { n, unit, .. } => Some(u64::from(*n) * unit.seconds()),
            _ => None,
        }
    }
}

fn check_clock(hour: u8, minute: u8) -> Result<(), String> {
    if hour > 23 {
        return Err("the hour must be between 0 and 23".into());
    }
    if minute > 59 {
        return Err("the minute must be between 0 and 59".into());
    }
    Ok(())
}

/// English weekday name for `day` (0 = Sunday), used only in log text.
const fn weekday_name(day: u8) -> &'static str {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_below_one_minute_is_rejected() {
        // The unit itself is fine; it's the product that's too small.
        let s = Schedule::Every {
            n: 30,
            unit: TimeUnit::Minutes,
            starts_at: 0,
        };
        assert!(s.validate().is_ok());
        assert_eq!(s.interval_seconds(), Some(1_800));

        let zero = Schedule::Every {
            n: 0,
            unit: TimeUnit::Hours,
            starts_at: 0,
        };
        assert!(zero.validate().is_err());
    }

    #[test]
    fn clock_presets_bound_their_fields() {
        assert!(Schedule::DailyAt {
            hour: 9,
            minute: 30
        }
        .validate()
        .is_ok());
        assert!(Schedule::DailyAt {
            hour: 24,
            minute: 0
        }
        .validate()
        .is_err());
        assert!(Schedule::WeekdaysAt {
            hour: 0,
            minute: 60
        }
        .validate()
        .is_err());
        assert!(Schedule::WeeklyAt {
            day: 7,
            hour: 1,
            minute: 0
        }
        .validate()
        .is_err());
        assert!(Schedule::WeeklyAt {
            day: 6,
            hour: 23,
            minute: 59
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn clock_presets_have_no_plain_interval() {
        // They must be emitted as calendar triggers, never as a repeat interval.
        assert_eq!(
            Schedule::DailyAt { hour: 9, minute: 0 }.interval_seconds(),
            None
        );
        assert_eq!(
            Schedule::WeeklyAt {
                day: 1,
                hour: 9,
                minute: 0
            }
            .interval_seconds(),
            None
        );
    }

    #[test]
    fn describe_reads_like_a_sentence() {
        assert_eq!(
            Schedule::Every {
                n: 15,
                unit: TimeUnit::Minutes,
                starts_at: 0
            }
            .describe(),
            "every 15 minutes"
        );
        assert_eq!(
            Schedule::DailyAt { hour: 9, minute: 5 }.describe(),
            "daily at 09:05"
        );
        assert_eq!(
            Schedule::WeeklyAt {
                day: 1,
                hour: 18,
                minute: 0
            }
            .describe(),
            "weekly on Monday at 18:00"
        );
    }

    #[test]
    fn serde_round_trips_tagged_camel_case() {
        let s = Schedule::Every {
            n: 2,
            unit: TimeUnit::Hours,
            starts_at: 1_700_000_000_000,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"kind\":\"every\""), "{json}");
        assert!(json.contains("\"startsAt\""), "{json}");
        assert_eq!(serde_json::from_str::<Schedule>(&json).unwrap(), s);
    }
}
