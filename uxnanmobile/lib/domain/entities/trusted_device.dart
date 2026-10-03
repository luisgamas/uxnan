import 'dart:typed_data';

import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';

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
    required this.sessionId,
    required this.pairedAt,
    this.relay,
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

  /// The bridge's own relay, used to reach it from another network, or `null`
  /// while it has none. Learned from the pairing QR and kept current from the
  /// bridge's shared settings (`BridgeSettings.relay`), so a PC paired on the
  /// LAN stays reachable away from it.
  final RelayEndpoint? relay;

  /// Direct `host:port` addresses (LAN / Tailscale `100.x`) advertised in the
  /// pairing QR. The transport selector tries these before [relay]. May be
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

  /// Returns a copy with selected fields replaced. [relay] is replaced by
  /// [withRelay], which can also clear it.
  TrustedDevice copyWith({
    String? displayName,
    List<String>? hosts,
    String? sessionId,
    DateTime? lastSeen,
    int? lastAppliedBridgeOutboundSeq,
  }) {
    return TrustedDevice(
      macDeviceId: macDeviceId,
      displayName: displayName ?? this.displayName,
      macIdentityPublicKey: macIdentityPublicKey,
      relay: relay,
      hosts: hosts ?? this.hosts,
      sessionId: sessionId ?? this.sessionId,
      pairedAt: pairedAt,
      lastSeen: lastSeen ?? this.lastSeen,
      lastAppliedBridgeOutboundSeq:
          lastAppliedBridgeOutboundSeq ?? this.lastAppliedBridgeOutboundSeq,
    );
  }

  /// Returns a copy that reaches the bridge through [relay] (`null`: none).
  TrustedDevice withRelay(RelayEndpoint? relay) => TrustedDevice(
        macDeviceId: macDeviceId,
        displayName: displayName,
        macIdentityPublicKey: macIdentityPublicKey,
        relay: relay,
        hosts: hosts,
        sessionId: sessionId,
        pairedAt: pairedAt,
        lastSeen: lastSeen,
        lastAppliedBridgeOutboundSeq: lastAppliedBridgeOutboundSeq,
      );

  @override
  List<Object?> get props => [
        macDeviceId,
        displayName,
        macIdentityPublicKey,
        relay,
        hosts,
        sessionId,
        pairedAt,
        lastSeen,
        lastAppliedBridgeOutboundSeq,
      ];
}
