import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';

/// A classified event derived from an inbound bridge notification
/// (spec 02a §5.2.5).
///
/// This increment models the conversation/turn streaming events and git action
/// progress; other stream notifications (plan, subagent, approval, connection,
/// workspace, auth) currently map to [UnknownDomainEvent] and gain dedicated
/// event types with their modules (FOR-DEV).
sealed class DomainEvent extends Equatable {
  const DomainEvent();
}

/// A turn started streaming.
class TurnStartedEvent extends DomainEvent {
  /// Creates a [TurnStartedEvent].
  const TurnStartedEvent({required this.turnId, this.threadId});

  /// The turn that started.
  final String turnId;

  /// The owning thread, if the bridge provided it.
  final String? threadId;

  @override
  List<Object?> get props => [turnId, threadId];
}

/// A streaming text delta for the active turn.
class MessageDeltaEvent extends DomainEvent {
  /// Creates a [MessageDeltaEvent].
  const MessageDeltaEvent({
    required this.turnId,
    required this.delta,
    this.threadId,
  });

  /// The turn being streamed.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  /// The text delta to append.
  final String delta;

  @override
  List<Object?> get props => [turnId, threadId, delta];
}

/// A turn finished successfully.
class TurnCompletedEvent extends DomainEvent {
  /// Creates a [TurnCompletedEvent].
  const TurnCompletedEvent({required this.turnId, this.threadId});

  /// The completed turn.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [turnId, threadId];
}

/// A turn ended in an error.
class TurnErrorEvent extends DomainEvent {
  /// Creates a [TurnErrorEvent].
  const TurnErrorEvent({required this.turnId, this.threadId, this.message});

  /// The turn that errored.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  /// The error message, if any.
  final String? message;

  @override
  List<Object?> get props => [turnId, threadId, message];
}

/// A turn was aborted by the user.
class TurnAbortedEvent extends DomainEvent {
  /// Creates a [TurnAbortedEvent].
  const TurnAbortedEvent({required this.turnId, this.threadId});

  /// The aborted turn.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [turnId, threadId];
}

/// The agent resolved its alias to a concrete model for a turn
/// (`stream/model/resolved`), e.g. `opus` → `claude-opus-4-8`.
class ModelResolvedEvent extends DomainEvent {
  /// Creates a [ModelResolvedEvent].
  const ModelResolvedEvent({
    required this.model,
    this.turnId,
    this.threadId,
  });

  /// The concrete model id the agent resolved.
  final String model;

  /// The turn it was resolved for, if provided.
  final String? turnId;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [model, turnId, threadId];
}

/// A progress update for a long-running git action (`stream/git/progress`).
class GitProgressEvent extends DomainEvent {
  /// Creates a [GitProgressEvent].
  const GitProgressEvent({
    required this.phase,
    required this.status,
    this.threadId,
  });

  /// The phase the bridge is reporting (e.g. `resolving`, `uploading`).
  final String phase;

  /// The phase's status.
  final GitActionPhaseStatus status;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [phase, status, threadId];
}

/// A notification not yet modeled as a specific domain event.
class UnknownDomainEvent extends DomainEvent {
  /// Creates an [UnknownDomainEvent].
  const UnknownDomainEvent({required this.method, this.params});

  /// The originating JSON-RPC method.
  final String method;

  /// The raw params, if any.
  final Map<String, dynamic>? params;

  @override
  List<Object?> get props => [method, params];
}
