/**
 * Every clock time the app shows, written one way: the 24-hour clock as a
 * fixed `HH:mm` (`14:30`, `00:25`), in every language and whatever the system
 * clock setting says.
 *
 * Times used to follow whatever each call site asked `Intl` for — the locale's
 * 12-hour clock in one place, `2-digit` hours in the next — so the same moment
 * read `2:30 PM` in the chat and `14:30` in the automations. Uxnan Mobile
 * writes its times the same way (`uxnanmobile/lib/core/utils/clock_format.dart`),
 * so a time reads the same on both.
 */

/** The clock time of `date`: `14:30`. */
export function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * A moment with its date and clock time: `Sep 12, 14:30`, or with
 * `withYear` `Sep 12, 2026, 14:30`. The date part follows `locale`.
 */
export function formatDateClock(
  date: Date,
  locale?: string,
  { withYear = false }: { withYear?: boolean } = {},
): string {
  const day = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
  });
  return `${day}, ${formatClock(date)}`;
}

/** A moment within the coming weeks, with its weekday: `Sat, Sep 12, 14:30`. */
export function formatWeekdayDateClock(date: Date, locale?: string): string {
  const day = date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day}, ${formatClock(date)}`;
}
