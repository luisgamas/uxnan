import 'package:equatable/equatable.dart';

/// A bridge discovered on the local network via mDNS/DNS-SD (`_uxnan._tcp`).
///
/// Carries only non-secret discovery hints advertised by the bridge: a display
/// [name], the reachable [host]/[port], and the optional [deviceId] (the PC's
/// `macDeviceId`). The pairing **code** is never advertised — the user still
/// types it after picking a discovered bridge.
class DiscoveredBridge extends Equatable {
  /// Creates a [DiscoveredBridge].
  const DiscoveredBridge({
    required this.name,
    required this.host,
    required this.port,
    this.deviceId,
  });

  /// Service instance display name (the bridge's hostname).
  final String name;

  /// Reachable host — an advertised IPv4 (preferred) or a `.local` name.
  final String host;

  /// TCP port the bridge's LAN server listens on.
  final int port;

  /// The PC's `macDeviceId` (TXT `id`), when advertised.
  final String? deviceId;

  /// The `host:port` string the manual-pairing flow expects.
  String get hostPort => '$host:$port';

  @override
  List<Object?> get props => [name, host, port, deviceId];
}
