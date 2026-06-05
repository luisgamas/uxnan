/// High-level state of a conversation thread.
enum ThreadStatus {
  /// The thread is active and usable.
  active,

  /// The thread has been archived by the user.
  archived,

  /// The thread is currently syncing its history from the bridge.
  syncing,

  /// The thread is in an error state.
  error,
}
