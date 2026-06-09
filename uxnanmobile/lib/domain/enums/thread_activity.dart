/// Live activity of a thread's agent, independent of the thread's sync status
/// (`ThreadStatus`). Drives the per-thread activity indicator in the list.
enum ThreadActivity {
  /// No turn is running right now.
  idle,

  /// A turn is in flight (the agent is responding), even if the conversation
  /// screen is not open.
  running,

  /// The last turn ended in an error.
  error,
}
