import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_action_kind.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
import 'package:uxnan/domain/value_objects/git/git_action_phase.dart';

/// Live progress of a long-running git action (commit/push), accumulated from
/// `stream/git/progress` events (spec 02a §5.5).
class GitActionProgress extends Equatable {
  /// Creates a [GitActionProgress].
  const GitActionProgress({
    required this.kind,
    this.phases = const [],
    this.error,
  });

  /// The action being tracked.
  final GitActionKind kind;

  /// The ordered phases reported so far.
  final List<GitActionPhase> phases;

  /// Terminal error message, if the action failed.
  final String? error;

  /// The phase currently running (the last non-terminal phase), if any.
  GitActionPhase? get currentPhase =>
      phases.where((p) => p.status == GitActionPhaseStatus.running).lastOrNull;

  /// Whether the action ended in an error.
  bool get hasError => error != null;

  /// Upserts a phase by [name], marking any previously running phases complete,
  /// and returns the updated progress.
  GitActionProgress withPhase(String name, GitActionPhaseStatus status) {
    final next = <GitActionPhase>[];
    var found = false;
    for (final phase in phases) {
      if (phase.name == name) {
        found = true;
        next.add(phase.copyWith(status: status));
      } else if (phase.status == GitActionPhaseStatus.running) {
        next.add(phase.copyWith(status: GitActionPhaseStatus.completed));
      } else {
        next.add(phase);
      }
    }
    if (!found) next.add(GitActionPhase(name: name, status: status));
    return GitActionProgress(kind: kind, phases: next, error: error);
  }

  /// Returns a copy marked as failed with [message], flagging any running
  /// phase as errored.
  GitActionProgress withError(String message) => GitActionProgress(
        kind: kind,
        phases: [
          for (final phase in phases)
            if (phase.status == GitActionPhaseStatus.running)
              phase.copyWith(status: GitActionPhaseStatus.error)
            else
              phase,
        ],
        error: message,
      );

  @override
  List<Object?> get props => [kind, phases, error];
}
