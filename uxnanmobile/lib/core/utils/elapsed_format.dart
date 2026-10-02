/// How long something took, the way the chat says it: `45s`, `1m 3s`,
/// `2h 5m`. Never negative.
///
/// The same rule Uxnan Desktop uses for its turn fold
/// (`uxnandesktop/src/lib/bridge/timeline.ts` → `formatElapsed`), so a turn
/// reads "Worked for 5m 52s" on both.
String formatElapsed(Duration elapsed) {
  final total = elapsed.isNegative ? 0 : elapsed.inSeconds;
  if (total < 60) return '${total}s';
  final minutes = total ~/ 60;
  if (minutes < 60) return '${minutes}m ${total % 60}s';
  return '${minutes ~/ 60}h ${minutes % 60}m';
}
