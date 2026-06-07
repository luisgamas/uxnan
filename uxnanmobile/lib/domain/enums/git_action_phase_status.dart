/// Status of a single phase within a long-running git action (spec 02a §5.5).
enum GitActionPhaseStatus {
  /// The phase has not started yet.
  pending,

  /// The phase is currently executing.
  running,

  /// The phase finished successfully.
  completed,

  /// The phase failed.
  error,
}
