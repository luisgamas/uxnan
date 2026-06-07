/// Execution state of a command run by the agent (spec 02a §6.2).
enum CommandStatus {
  /// The command is still running.
  running,

  /// The command finished successfully.
  completed,

  /// The command failed.
  error,
}
