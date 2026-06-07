/// Severity/kind of a system message (spec 02a §6.2).
enum SystemContentKind {
  /// Informational message.
  info,

  /// Warning message.
  warning,

  /// Error message.
  error,

  /// Debug message.
  debug,
}
