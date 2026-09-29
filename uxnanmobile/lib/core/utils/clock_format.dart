import 'package:intl/intl.dart';

/// Every clock time the app shows, written one way: the 24-hour clock
/// (`14:30`), in every language and whatever the phone's 12/24-hour setting.
///
/// There used to be three answers — conversation rows always on 24 hours, a
/// PC's "last connection" on the phone's own setting, provider resets on a
/// switch of their own — so the same moment read `00:25` in one place and
/// `12:25 AM` in the next. Uxnan Desktop writes its times the same way
/// (`uxnandesktop/src/lib/clock.ts`), so a time reads the same on both.
///
/// A fixed `HH:mm`, not the locale's `Hm` skeleton: Spanish writes that as
/// `0:25`, English as `00:25`, and a time must read the same in both.
String formatClock(DateTime time) => _clock.format(time);

final DateFormat _clock = DateFormat('HH:mm');

/// A moment as the lists show it: the clock time today, the date before that —
/// a lone time from last week is worse than no time at all. With
/// [keepClock] a day before today keeps its time too (`Sep 12, 14:30`), for a
/// line that must say exactly when.
String formatWhen(DateTime time, {bool keepClock = false, DateTime? now}) {
  final today = now ?? DateTime.now();
  final sameDay = today.year == time.year &&
      today.month == time.month &&
      today.day == time.day;
  if (sameDay) return formatClock(time);
  final date = DateFormat.MMMd().format(time);
  return keepClock ? '$date, ${formatClock(time)}' : date;
}
