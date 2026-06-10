import 'package:equatable/equatable.dart';

/// The sanitized authentication status of a bridge agent (`auth/status`).
///
/// Mirrors the bridge contract `AuthStatus = { agentId, requiresLogin,
/// loginInProgress, authenticatedProvider?, displayName?, transportMode,
/// platform }`. It is SANITIZED by design — the bridge never sends tokens or
/// keys; login is detected from the existence of the agent's auth file, never
/// its contents. The parser is tolerant so the app degrades gracefully against
/// newer bridges.
class AuthStatus extends Equatable {
  /// Creates an [AuthStatus].
  const AuthStatus({
    required this.agentId,
    required this.requiresLogin,
    required this.loginInProgress,
    this.authenticatedProvider,
    this.displayName,
    this.transportMode,
    this.platform,
  });

  /// Reconstructs an [AuthStatus] from an `auth/status` result.
  factory AuthStatus.fromJson(Map<String, dynamic> json) => AuthStatus(
        agentId: json['agentId'] as String? ?? '',
        requiresLogin: json['requiresLogin'] == true,
        loginInProgress: json['loginInProgress'] == true,
        authenticatedProvider: json['authenticatedProvider'] as String?,
        displayName: json['displayName'] as String?,
        transportMode: json['transportMode'] as String?,
        platform: json['platform'] as String?,
      );

  /// The agent's wire identifier (see `AgentId.wireId`).
  final String agentId;

  /// Whether the agent must be logged in on the PC before it can be used.
  final bool requiresLogin;

  /// Whether an interactive login is currently in progress on the PC.
  final bool loginInProgress;

  /// The provider the agent is authenticated against, when known (sanitized —
  /// never a token).
  final String? authenticatedProvider;

  /// A human-readable name for the agent, when the bridge provides one.
  final String? displayName;

  /// The transport the bridge answered over (`local` or `relay`), when known.
  final String? transportMode;

  /// The bridge host's platform identifier, when known.
  final String? platform;

  @override
  List<Object?> get props => [
        agentId,
        requiresLogin,
        loginInProgress,
        authenticatedProvider,
        displayName,
        transportMode,
        platform,
      ];
}
