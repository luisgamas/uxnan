/// Status of a single step in an agent plan (spec 02a §6.2, `PlanStepStatus`).
///
/// Wire values are snake_case (`pending`, `in_progress`, `completed`).
enum PlanStepStatus {
  /// Not started yet.
  pending,

  /// Currently being worked on.
  inProgress,

  /// Finished.
  completed,
}
