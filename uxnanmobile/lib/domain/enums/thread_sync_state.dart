/// Synchronization state of a thread's local cache relative to the bridge.
enum ThreadSyncState {
  /// Local history matches the bridge.
  synced,

  /// A sync is currently in progress.
  syncing,

  /// The local cache is behind the bridge and needs a catch-up.
  behind,

  /// The thread exists only locally and has not been reconciled yet.
  localOnly,
}
