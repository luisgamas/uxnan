import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/value_objects/bridge_update.dart';

/// The bridge daemon's reported status (`bridge/status`). Sanitized and
/// non-secret. Mirrors the contract `BridgeStatus = { version, relayConnected,
/// lanEnabled, activeSessions, platform, uptimeMs, update?, features? }`; the
/// parser is tolerant so the app degrades gracefully against newer/older
/// bridges.
class BridgeStatus extends Equatable {
  /// Creates a [BridgeStatus].
  const BridgeStatus({
    required this.relayConnected,
    this.version,
    this.lanEnabled,
    this.activeSessions,
    this.update,
    this.supportsMessageQueue = false,
    this.supportsManagedWorktrees = false,
  });

  /// Reconstructs a [BridgeStatus] from a `bridge/status` result.
  factory BridgeStatus.fromJson(Map<String, dynamic> json) {
    final features = json['features'];
    return BridgeStatus(
      relayConnected: json['relayConnected'] == true,
      version: json['version'] as String?,
      lanEnabled:
          json['lanEnabled'] is bool ? json['lanEnabled'] as bool : null,
      activeSessions: (json['activeSessions'] as num?)?.toInt(),
      update: BridgeUpdate.fromJson(json['update']),
      // Absent → false. Assuming a capability the bridge lacks is not a
      // cosmetic mistake here: offering to queue against a bridge that cannot
      // queue makes it start a second concurrent turn, corrupting the session.
      supportsMessageQueue: features is Map && features['messageQueue'] == true,
      supportsManagedWorktrees:
          features is Map && features['managedWorktrees'] == true,
    );
  }

  /// Whether the bridge is currently serving this phone over the hosted relay
  /// (false means a direct LAN/Tailscale connection).
  final bool relayConnected;

  /// The bridge daemon version, when reported.
  final String? version;

  /// Whether the bridge's direct LAN server is enabled, when reported.
  final bool? lanEnabled;

  /// The number of phone sessions the bridge is serving, when reported.
  final int? activeSessions;

  /// The bridge's own update. **Null on a bridge that predates updating
  /// itself** — one older than this app, which then asks to update it on the
  /// PC.
  final BridgeUpdate? update;

  /// Whether the bridge queues a `turn/send` sent while a turn is in flight
  /// (`features.messageQueue`). **False on any bridge that doesn't advertise
  /// it**, which is the only safe default: on such a bridge a second send
  /// starts a concurrent turn instead of queueing, killing the running one. The
  /// conversation screen hides the "queue message" action unless this is true.
  final bool supportsMessageQueue;

  /// Whether the bridge places a new worktree itself when `git/createWorktree`
  /// is sent without a `path` (`features.managedWorktrees`), under the same
  /// managed layout the desktop uses. **False on any bridge that doesn't
  /// advertise it**, where `path` is still required — so the phone keeps
  /// deriving one as its fallback.
  final bool supportsManagedWorktrees;

  @override
  List<Object?> get props => [
        relayConnected,
        version,
        lanEnabled,
        activeSessions,
        update,
        supportsMessageQueue,
        supportsManagedWorktrees,
      ];
}
