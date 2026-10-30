/// Convenience helpers on [String] used across the app.
extension StringExt on String {
  /// Whether this string is empty or contains only whitespace.
  bool get isBlank => trim().isEmpty;

  /// Whether this string contains at least one non-whitespace character.
  bool get isNotBlank => !isBlank;

  /// Returns this string truncated to [maxLength] characters, appending an
  /// ellipsis when truncation occurs.
  String truncate(int maxLength, {String ellipsis = '…'}) {
    if (length <= maxLength) return this;
    return '${substring(0, maxLength)}$ellipsis';
  }

  /// Returns this string shortened in the middle to at most [maxLength]
  /// characters, keeping its start and its end — for a file name, whose
  /// extension and last word tell it apart: `screenshot-2026…final.png`.
  String truncateMiddle(int maxLength, {String ellipsis = '…'}) {
    final chars = runes.toList();
    if (chars.length <= maxLength) return this;
    final room = maxLength - ellipsis.runes.length;
    if (room <= 1) return truncate(maxLength, ellipsis: ellipsis);
    final tail = room ~/ 2;
    final head = room - tail;
    return String.fromCharCodes(chars.take(head)) +
        ellipsis +
        String.fromCharCodes(chars.skip(chars.length - tail));
  }

  /// Returns `null` when this string is blank, otherwise the string itself.
  String? get nullIfBlank => isBlank ? null : this;
}
