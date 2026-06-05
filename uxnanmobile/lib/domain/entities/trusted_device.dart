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
    this.lastSeen,
  });

  /// Bridge device identifier.
  final String macDeviceId;

  /// Human readable bridge name.
  final String displayName;

  /// Bridge's Ed25519 identity public key (32 bytes).
  final Uint8List macIdentityPublicKey;

  /// Relay URL used to reach the bridge.
  final String relayUrl;

  /// Session id established during pairing.
  final String sessionId;

  /// When this device was paired.
  final DateTime pairedAt;

  /// When this device was last seen, if ever.
  final DateTime? lastSeen;

  /// Returns a copy with selected fields replaced.
  TrustedDevice copyWith({
    String? displayName,
    String? relayUrl,
    String? sessionId,
    DateTime? lastSeen,
  }) {
    return TrustedDevice(
      macDeviceId: macDeviceId,
      displayName: displayName ?? this.displayName,
      macIdentityPublicKey: macIdentityPublicKey,
      relayUrl: relayUrl ?? this.relayUrl,
      sessionId: sessionId ?? this.sessionId,
      pairedAt: pairedAt,
      lastSeen: lastSeen ?? this.lastSeen,
    );
  }

  @override
  List<Object?> get props => [
        macDeviceId,
        displayName,
        macIdentityPublicKey,
        relayUrl,
        sessionId,
        pairedAt,
        lastSeen,
      ];
}
