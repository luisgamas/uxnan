import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';

/// An approval or question the agent asked that is no longer waiting — the
/// bridge announced it answered (here or on another client) or timed out.
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
    required this.timedOut,
  });

  /// The approval's id.
  final String approvalId;

  /// What the agent got; null when the wire name is unknown to this app.
  final ApprovalDecision? decision;

  /// True when nobody answered and it defaulted to reject.
  final bool timedOut;

  @override
  List<Object?> get props => [approvalId, decision, timedOut];
}

/// A pending question was settled with [answers].
class QuestionResolution extends ElicitationResolution {
  /// Creates a [QuestionResolution].
  const QuestionResolution({
    required this.questionId,
    required this.answers,
    required this.timedOut,
  });

  /// The question's id.
  final String questionId;

  /// The chosen labels, one list per question.
  final List<List<String>> answers;

  /// True when nobody answered in time.
  final bool timedOut;

  @override
  List<Object?> get props => [questionId, answers, timedOut];
}
