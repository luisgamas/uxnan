/// Kind of action a subagent performed (spec 02a §6.2, `SubagentActionKind`).
///
/// The set is intentionally small with an [unknown] fallback so newer bridge
/// values degrade gracefully to a generic icon.
enum SubagentActionKind {
  /// Invoked a tool.
  tool,

  /// Edited a file.
  edit,

  /// Ran a command.
  command,

  /// Emitted a message.
  message,

  /// Unrecognized / not reported.
  unknown,
}
