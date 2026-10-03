import 'package:equatable/equatable.dart';
import 'package:uxnan/core/errors/relay_exception.dart';

/// Observable state of the automatic reconnection process.
///
/// Mirrors `architecture/02c-implementation-guide.md` (section 11.2). After
/// [maxAttempts] failed retries the connection enters a terminal error state
/// requiring manual intervention.
class ConnectionRecoveryState extends Equatable {
  /// Creates a [ConnectionRecoveryState].
  const ConnectionRecoveryState({
    this.isRecovering = false,
    this.attempt = 0,
    this.maxAttempts = 10,
    this.nextRetryIn = Duration.zero,
    this.lastConnectedAt,
    this.lastErrorMessage,
    this.lastRelayFailure,
    this.requiresManualIntervention = false,
  });

  /// Whether a reconnection is currently in progress.
  final bool isRecovering;

  /// Current attempt number (1-based).
  final int attempt;

  /// Maximum number of attempts before giving up.
  final int maxAttempts;

  /// Time remaining until the next retry.
  final Duration nextRetryIn;

  /// When the session was last successfully connected.
  final DateTime? lastConnectedAt;

  /// The most recent error message, if any.
  final String? lastErrorMessage;

  /// Why the user's relay refused or dropped the last attempt, when it was the
  /// relay that said no (the PC is offline, this phone is no longer paired,
  /// the relay is full…). Null when the last attempt failed some other way or
  /// nothing has failed yet. It stands until a later attempt fails differently
  /// or the connection is back, so the UI can say why while it waits.
  final RelayFailure? lastRelayFailure;

  /// Whether [maxAttempts] was exceeded and the user must intervene.
  final bool requiresManualIntervention;

  /// Returns a copy with selected fields replaced.
  ConnectionRecoveryState copyWith({
    bool? isRecovering,
    int? attempt,
    int? maxAttempts,
    Duration? nextRetryIn,
    DateTime? lastConnectedAt,
    String? lastErrorMessage,
    RelayFailure? lastRelayFailure,
    bool? requiresManualIntervention,
  }) {
    return ConnectionRecoveryState(
      isRecovering: isRecovering ?? this.isRecovering,
      attempt: attempt ?? this.attempt,
      maxAttempts: maxAttempts ?? this.maxAttempts,
      nextRetryIn: nextRetryIn ?? this.nextRetryIn,
      lastConnectedAt: lastConnectedAt ?? this.lastConnectedAt,
      lastErrorMessage: lastErrorMessage ?? this.lastErrorMessage,
      lastRelayFailure: lastRelayFailure ?? this.lastRelayFailure,
      requiresManualIntervention:
          requiresManualIntervention ?? this.requiresManualIntervention,
    );
  }

  @override
  List<Object?> get props => [
        isRecovering,
        attempt,
        maxAttempts,
        nextRetryIn,
        lastConnectedAt,
        lastErrorMessage,
        lastRelayFailure,
        requiresManualIntervention,
      ];
}
