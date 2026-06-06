import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_action_kind.dart';

/// A recorded git action and its outcome (spec 02c §10.1).
///
/// Persisted to the local `git_action_log` table so the conversation can show a
/// history of commits/pushes performed from the app.
class GitActionLogEntry extends Equatable {
  /// Creates a [GitActionLogEntry].
  const GitActionLogEntry({
    required this.id,
    required this.threadId,
    required this.kind,
    required this.succeeded,
    required this.paramsJson,
    required this.startedAt,
    this.resultJson,
    this.errorMessage,
    this.completedAt,
  });

  /// Unique log entry id.
  final String id;

  /// Owning thread id.
  final String threadId;

  /// The kind of action performed.
  final GitActionKind kind;

  /// Whether the action completed successfully.
  final bool succeeded;

  /// Action parameters serialized as JSON.
  final String paramsJson;

  /// Action result serialized as JSON, if successful.
  final String? resultJson;

  /// Error message, if the action failed.
  final String? errorMessage;

  /// When the action started.
  final DateTime startedAt;

  /// When the action finished, if it did.
  final DateTime? completedAt;

  @override
  List<Object?> get props => [
        id,
        threadId,
        kind,
        succeeded,
        paramsJson,
        resultJson,
        errorMessage,
        startedAt,
        completedAt,
      ];
}
