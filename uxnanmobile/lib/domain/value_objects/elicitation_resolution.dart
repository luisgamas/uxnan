import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';

/// An approval or question the agent asked that is no longer waiting — the
/// bridge announced it answered (here or on another client), or withdrawn: no
/// person answered it — the agent settled it itself, or the run that asked
/// ended. A request never ends on a clock.
///
/// The cards that render these are keyed by id, so a resolution is enough to
/// retire every copy of one, on every client showing it.
sealed class ElicitationResolution extends Equatable {
  const ElicitationResolution();
}

/// A pending approval was settled with [decision].
class ApprovalResolution extends ElicitationResolution {
  /// Creates an [ApprovalResolution].
  const ApprovalResolution({
    required this.approvalId,
    required this.decision,
    required this.withdrawn,
  });

  /// The approval's id.
  final String approvalId;

  /// What the agent got; null when the wire name is unknown to this app.
  final ApprovalDecision? decision;

  /// True when no person answered it: [decision] is what the bridge told the
  /// agent, never anyone's choice.
  final bool withdrawn;

  @override
  List<Object?> get props => [approvalId, decision, withdrawn];
}

/// A pending question was settled with [answers].
class QuestionResolution extends ElicitationResolution {
  /// Creates a [QuestionResolution].
  const QuestionResolution({
    required this.questionId,
    required this.answers,
    required this.withdrawn,
  });

  /// The question's id.
  final String questionId;

  /// The chosen labels, one list per question.
  final List<List<String>> answers;

  /// True when no person answered it.
  final bool withdrawn;

  @override
  List<Object?> get props => [questionId, answers, withdrawn];
}
