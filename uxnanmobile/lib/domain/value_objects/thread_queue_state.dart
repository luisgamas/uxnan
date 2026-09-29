import 'package:equatable/equatable.dart';

/// Why the bridge is holding a thread's message queue instead of draining it
/// (mirrors the contract's `QueuePausedReason`).
enum QueuePausedReason {
  /// The user stopped the running turn.
  turnAborted,

  /// The running turn failed (auth, balance, a dead CLI).
  turnError;

  /// Parses the wire value, defaulting to [turnAborted] for an unknown one —
  /// the banner it drives says the same thing either way.
  static QueuePausedReason fromWire(Object? value) {
    for (final reason in QueuePausedReason.values) {
      if (reason.name == value) return reason;
    }
    return QueuePausedReason.turnAborted;
  }
}

/// A thread's message queue as the bridge reports it: the follow-ups the user
/// sent while a turn was in flight, and whether draining is currently held.
///
/// The queue lives on the bridge, not here — it has to drain while the app is
/// backgrounded or closed, which is the whole point of sending a follow-up and
/// pocketing the phone. This is the phone's view of it, refreshed by
/// `stream/queue/updated` and re-read on every `turn/list` resync.
class ThreadQueueState extends Equatable {
  /// Creates a [ThreadQueueState].
  const ThreadQueueState({
    this.turnIds = const [],
    this.paused = false,
    this.pausedReason,
    this.deliveringTurnId,
  });

  /// An idle thread: nothing queued, nothing held.
  static const ThreadQueueState empty = ThreadQueueState();

  /// Queued turn ids, in the order they will run.
  final List<String> turnIds;

  /// Whether the bridge is holding the queue (see [pausedReason]).
  final bool paused;

  /// Why it is held; null when it is not paused.
  final QueuePausedReason? pausedReason;

  /// The queued turn the running agent is taking now, or null.
  ///
  /// An agent that takes messages while it works gets the first queued one at
  /// its next pause; until it reads it the message stays listed in [turnIds],
  /// but it can no longer be edited, cancelled or sent now — the bridge
  /// refuses all three.
  final String? deliveringTurnId;

  /// How many messages are waiting.
  int get length => turnIds.length;

  /// Whether anything is waiting.
  bool get isNotEmpty => turnIds.isNotEmpty;

  /// Whether [turnId] is the message being handed to the running agent.
  bool isDelivering(String turnId) =>
      deliveringTurnId != null && deliveringTurnId == turnId;

  /// The 1-based place of [turnId] in the queue, or null when it isn't queued.
  int? positionOf(String turnId) {
    final index = turnIds.indexOf(turnId);
    return index < 0 ? null : index + 1;
  }

  /// Returns a copy with the given fields replaced.
  ThreadQueueState copyWith({
    List<String>? turnIds,
    bool? paused,
    QueuePausedReason? pausedReason,
    bool clearPausedReason = false,
    String? deliveringTurnId,
    bool clearDeliveringTurnId = false,
  }) {
    return ThreadQueueState(
      turnIds: turnIds ?? this.turnIds,
      paused: paused ?? this.paused,
      pausedReason:
          clearPausedReason ? null : (pausedReason ?? this.pausedReason),
      deliveringTurnId: clearDeliveringTurnId
          ? null
          : (deliveringTurnId ?? this.deliveringTurnId),
    );
  }

  @override
  List<Object?> get props => [turnIds, paused, pausedReason, deliveringTurnId];
}
