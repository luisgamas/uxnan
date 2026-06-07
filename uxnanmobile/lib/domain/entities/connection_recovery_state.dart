import 'package:equatable/equatable.dart';

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
    bool? requiresManualIntervention,
  }) {
    return ConnectionRecoveryState(
      isRecovering: isRecovering ?? this.isRecovering,
      attempt: attempt ?? this.attempt,
      maxAttempts: maxAttempts ?? this.maxAttempts,
      nextRetryIn: nextRetryIn ?? this.nextRetryIn,
      lastConnectedAt: lastConnectedAt ?? this.lastConnectedAt,
      lastErrorMessage: lastErrorMessage ?? this.lastErrorMessage,
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
        requiresManualIntervention,
      ];
}
