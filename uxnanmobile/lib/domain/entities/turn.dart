import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/turn_status.dart';

/// A turn: a user message plus the agent's response (spec 02a §5.1.1).
///
/// The advanced per-turn state (git progress, subagent and plan state) is
/// deferred (FOR-DEV) until those modules land.
class Turn extends Equatable {
  /// Creates a [Turn].
  const Turn({
    required this.id,
    required this.threadId,
    required this.status,
    required this.startedAt,
    this.messages = const [],
    this.completedAt,
    this.continuedIn,
  });

  /// Unique turn id.
  final String id;

  /// Owning thread id.
  final String threadId;

  /// Lifecycle status.
  final TurnStatus status;

  /// Messages that make up this turn, in order.
  final List<Message> messages;

  /// When the turn started.
  final DateTime startedAt;

  /// When the turn completed, if it has.
  final DateTime? completedAt;

  /// The later turn this one's agent run went on in, when a message reached
  /// the agent while it was still answering here (`Turn.continuedIn` in the
  /// shared contract). What this turn holds is then the answer so far, not a
  /// closing one. Null otherwise, and from an older bridge.
  final String? continuedIn;

  /// Returns a copy with the given fields replaced.
  Turn copyWith({
    TurnStatus? status,
    List<Message>? messages,
    DateTime? completedAt,
    String? continuedIn,
  }) {
    return Turn(
      id: id,
      threadId: threadId,
      status: status ?? this.status,
      startedAt: startedAt,
      messages: messages ?? this.messages,
      completedAt: completedAt ?? this.completedAt,
      continuedIn: continuedIn ?? this.continuedIn,
    );
  }

  @override
  List<Object?> get props => [
        id,
        threadId,
        status,
        messages,
        startedAt,
        completedAt,
        continuedIn,
      ];
}
