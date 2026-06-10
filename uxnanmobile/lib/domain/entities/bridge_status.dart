import 'package:equatable/equatable.dart';

/// The bridge daemon's reported status (`bridge/status`). Sanitized and
/// non-secret. Mirrors the contract `BridgeStatus = { version, relayConnected,
/// lanEnabled, activeSessions, platform, uptimeMs }`; the parser is tolerant so
/// the app degrades gracefully against newer/older bridges.
class BridgeStatus extends Equatable {
  /// Creates a [BridgeStatus].
  const BridgeStatus({
    required this.relayConnected,
    this.version,
    this.lanEnabled,
    this.activeSessions,
  });

  /// Reconstructs a [BridgeStatus] from a `bridge/status` result.
  factory BridgeStatus.fromJson(Map<String, dynamic> json) => BridgeStatus(
        relayConnected: json['relayConnected'] == true,
        version: json['version'] as String?,
        lanEnabled:
            json['lanEnabled'] is bool ? json['lanEnabled'] as bool : null,
        activeSessions: (json['activeSessions'] as num?)?.toInt(),
      );

  /// Whether the bridge is currently serving this phone over the hosted relay
  /// (false means a direct LAN/Tailscale connection).
  final bool relayConnected;

  /// The bridge daemon version, when reported.
  final String? version;

  /// Whether the bridge's direct LAN server is enabled, when reported.
  final bool? lanEnabled;

  /// The number of phone sessions the bridge is serving, when reported.
  final int? activeSessions;

  @override
  List<Object?> get props =>
      [relayConnected, version, lanEnabled, activeSessions];
}
