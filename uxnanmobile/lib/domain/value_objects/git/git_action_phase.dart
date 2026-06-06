import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';

/// One phase of a multi-step git action (e.g. push: resolving, uploading,
/// complete), with its current [status] (spec 02a §5.5).
class GitActionPhase extends Equatable {
  /// Creates a [GitActionPhase].
  const GitActionPhase({
    required this.name,
    required this.status,
    this.output,
  });

  /// Phase identifier as reported by the bridge (e.g. `uploading`).
  final String name;

  /// Current status of the phase.
  final GitActionPhaseStatus status;

  /// Optional textual output emitted for this phase.
  final String? output;

  /// Returns a copy with the given fields replaced.
  GitActionPhase copyWith({GitActionPhaseStatus? status, String? output}) =>
      GitActionPhase(
        name: name,
        status: status ?? this.status,
        output: output ?? this.output,
      );

  @override
  List<Object?> get props => [name, status, output];
}
