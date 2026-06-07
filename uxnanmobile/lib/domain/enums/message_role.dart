/// The author role of a message within a conversation timeline.
enum MessageRole {
  /// A message authored by the human user.
  user,

  /// A message produced by the coding agent.
  assistant,

  /// A system message (instructions, context, status).
  system,

  /// Output emitted by a tool or command invocation.
  tool,
}
