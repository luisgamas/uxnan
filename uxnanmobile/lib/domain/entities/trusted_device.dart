import 'dart:typed_data';

import 'package:equatable/equatable.dart';

/// A bridge (PC) the phone has paired with and trusts.
///
/// Mirrors the entity in `architecture/02a-system-architecture.md` (section
/// 5.1.1). The [macIdentityPublicKey] is used to verify the bridge's Ed25519
/// signature during every handshake.
class TrustedDevice extends Equatable {
  /// Creates a [TrustedDevice].
  const TrustedDevice({
    required this.macDeviceId,
    required this.displayName,
    required this.macIdentityPublicKey,
    required this.relayUrl,
    required this.sessionId,
    required this.pairedAt,
    this.hosts = const [],
    this.lastSeen,
    this.lastAppliedBridgeOutboundSeq = 0,
  });

  /// Bridge device identifier.
  final String macDeviceId;

  /// Human readable bridge name.
  final String displayName;

  /// Bridge's Ed25519 identity public key (32 bytes).
  final Uint8List macIdentityPublicKey;

  /// Relay URL used to reach the bridge, or empty for a pure LAN/Tailscale
  /// device that is only reachable through [hosts].
  final String relayUrl;

  /// Direct `host:port` addresses (LAN / Tailscale `100.x`) advertised in the
  /// pairing QR. The transport selector tries these before [relayUrl]. May be
  /// empty (relay-only device).
  final List<String> hosts;

  /// Session id established during pairing.
  final String sessionId;

  /// When this device was paired.
  final DateTime pairedAt;

  /// When this device was last seen, if ever.
  final DateTime? lastSeen;

  /// Highest bridge→phone sequence number this phone has applied for this
  /// device. Persisted so a reconnect can advertise it in
  /// `clientHello.resumeState.lastAppliedBridgeOutboundSeq` and the bridge can
  /// replay only the outbound it missed (spec 02a §5.9.2). 0 = none yet.
  final int lastAppliedBridgeOutboundSeq;

  /// Returns a copy with selected fields replaced.
  TrustedDevice copyWith({
    String? displayName,
    String? relayUrl,
    List<String>? hosts,
    String? sessionId,
    DateTime? lastSeen,
    int? lastAppliedBridgeOutboundSeq,
  }) {
    return TrustedDevice(
      macDeviceId: macDeviceId,
      displayName: displayName ?? this.displayName,
      macIdentityPublicKey: macIdentityPublicKey,
      relayUrl: relayUrl ?? this.relayUrl,
      hosts: hosts ?? this.hosts,
      sessionId: sessionId ?? this.sessionId,
      pairedAt: pairedAt,
      lastSeen: lastSeen ?? this.lastSeen,
      lastAppliedBridgeOutboundSeq:
          lastAppliedBridgeOutboundSeq ?? this.lastAppliedBridgeOutboundSeq,
    );
  }

  @override
  List<Object?> get props => [
        macDeviceId,
        displayName,
        macIdentityPublicKey,
        relayUrl,
        hosts,
        sessionId,
        pairedAt,
        lastSeen,
        lastAppliedBridgeOutboundSeq,
      ];
}
