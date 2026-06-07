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

  /// Returns `null` when this string is blank, otherwise the string itself.
  String? get nullIfBlank => isBlank ? null : this;
}
