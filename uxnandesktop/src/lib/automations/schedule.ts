// Calendar math for automations — deliberately the **only** place it lives.
//
// The backend does none of this on purpose (see `architecture/02f` §2.1): the OS
// scheduler is the authority on *when* a run fires, so duplicating occurrence
// arithmetic in Rust would only create drift. Here it serves two jobs, both
// safe to own in the frontend:
//
// 1. the **preview** ("next runs"), which is display-only, and
// 2. the **start boundary** handed to the backend at save time, which every
//    platform wants expressed in local time — and local time is exactly what
//    `Date` gives us for free.
//
// Pure functions, no Svelte, so every branch is unit-tested.

import type { Schedule, TimeUnit } from "./types";

/** Smallest interval the backend accepts, in milliseconds. */
const MIN_INTERVAL_MS = 60_000;

/** Milliseconds in one unit of an `every` interval. */
const UNIT_MS: Record<TimeUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

/** The interval of an `every` schedule in milliseconds. */
export function intervalMs(schedule: Schedule): number | null {
  if (schedule.kind !== "every") return null;
  return Math.max(1, schedule.n) * UNIT_MS[schedule.unit];
}

/** Whether a date falls Monday–Friday. */
function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

/** A copy of `d` with the clock set to `hour`:`minute` (local). */
function atClock(d: Date, hour: number, minute: number): Date {
  const out = new Date(d);
  out.setHours(hour, minute, 0, 0);
  return out;
}

/** The next `count` moments this schedule fires, strictly after `from`.
 *
 *  Interval schedules are anchored on `startsAt` so the preview matches what the
 *  OS will actually do; an anchor in the past is advanced by whole intervals
 *  rather than restarted, which keeps a long-running automation's cadence
 *  stable instead of silently shifting every time the editor is opened. */
export function nextOccurrences(schedule: Schedule, from: Date, count = 5): Date[] {
  const out: Date[] = [];
  if (count <= 0) return out;

  if (schedule.kind === "every") {
    const step = intervalMs(schedule) ?? UNIT_MS.hours;
    const anchor = schedule.startsAt > 0 ? schedule.startsAt : from.getTime();
    let next = anchor;
    if (next <= from.getTime()) {
      const elapsed = from.getTime() - anchor;
      next = anchor + (Math.floor(elapsed / step) + 1) * step;
    }
    for (let i = 0; i < count; i += 1) out.push(new Date(next + i * step));
    return out;
  }

  // Clock-time presets: walk forward day by day from today, keeping the days
  // that match. Bounded by `count` matches, so a weekly schedule scans at most
  // a few weeks.
  const { hour, minute } = schedule;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  // A year of days is far more than enough for any of these shapes.
  for (let i = 0; i < 400 && out.length < count; i += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + i);
    const candidate = atClock(day, hour, minute);
    if (candidate.getTime() <= from.getTime()) continue;
    const matches =
      schedule.kind === "dailyAt" ||
      (schedule.kind === "weekdaysAt" && isWeekday(candidate)) ||
      (schedule.kind === "weeklyAt" && candidate.getDay() === schedule.day);
    if (matches) out.push(candidate);
  }
  return out;
}

/** The next single moment this schedule fires, or `null` if it never does. */
export function nextOccurrence(schedule: Schedule, from: Date): Date | null {
  return nextOccurrences(schedule, from, 1)[0] ?? null;
}

/** Format a local date as the `YYYY-MM-DDTHH:MM:SS` the backend hands to every
 *  OS scheduler. Deliberately **not** ISO/UTC: a task must fire at the user's
 *  wall-clock time, so this must carry no timezone suffix. */
export function toLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** The start boundary to register with, computed from `from` (defaults to now).
 *  Falls back to `from` itself when a schedule somehow yields no occurrence, so
 *  saving can never fail for want of a timestamp. */
export function startBoundary(schedule: Schedule, from: Date = new Date()): string {
  return toLocalIso(nextOccurrence(schedule, from) ?? from);
}

/** Validation errors for a schedule, mirroring the backend's own rules so the
 *  editor can object immediately instead of after a round trip. */
export function validateSchedule(schedule: Schedule): string[] {
  const errors: string[] = [];
  if (schedule.kind === "every") {
    if (!Number.isInteger(schedule.n) || schedule.n < 1) {
      errors.push("interval");
    } else if ((intervalMs(schedule) ?? 0) < MIN_INTERVAL_MS) {
      errors.push("intervalTooSmall");
    }
    return errors;
  }
  if (schedule.hour < 0 || schedule.hour > 23) errors.push("hour");
  if (schedule.minute < 0 || schedule.minute > 59) errors.push("minute");
  if (schedule.kind === "weeklyAt" && (schedule.day < 0 || schedule.day > 6)) {
    errors.push("weekday");
  }
  return errors;
}

/** Whether two schedules describe the same recurrence (used to decide whether a
 *  save needs to re-register the OS task). */
export function sameSchedule(a: Schedule, b: Schedule): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "every" && b.kind === "every") {
    return a.n === b.n && a.unit === b.unit && a.startsAt === b.startsAt;
  }
  if (a.kind === "weeklyAt" && b.kind === "weeklyAt") {
    return a.day === b.day && a.hour === b.hour && a.minute === b.minute;
  }
  if (a.kind !== "every" && b.kind !== "every") {
    return a.hour === b.hour && a.minute === b.minute;
  }
  return false;
}
