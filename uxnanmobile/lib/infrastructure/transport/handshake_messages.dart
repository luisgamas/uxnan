import 'dart:typed_data';

import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';

/// Wire strings for [HandshakeMode] (spec 02a §5.9.1).
extension HandshakeModeWire on HandshakeMode {
  /// The wire value (`qr_bootstrap` / `trusted_reconnect`).
  String get wire => switch (this) {
        HandshakeMode.qrBootstrap => 'qr_bootstrap',
        HandshakeMode.trustedReconnect => 'trusted_reconnect',
      };

  /// Parses a handshake mode wire value.
  static HandshakeMode parse(String wire) => switch (wire) {
        'trusted_reconnect' => HandshakeMode.trustedReconnect,
        _ => HandshakeMode.qrBootstrap,
      };
}

/// `clientHello` — first handshake message sent by the phone (spec 02a §5.9.1).
class ClientHello {
  /// Creates a [ClientHello].
  const ClientHello({
    required this.sessionId,
    required this.handshakeMode,
    required this.phoneDeviceId,
    required this.phoneIdentityPublicKey,
    required this.phoneEphemeralPublicKey,
    required this.clientNonce,
    this.protocolVersion = 1,
  });

  /// Discriminator.
  static const String kind = 'clientHello';

  /// Protocol version (1).
  final int protocolVersion;

  /// Session id.
  final String sessionId;

  /// Handshake mode.
  final HandshakeMode handshakeMode;

  /// Phone device id.
  final String phoneDeviceId;

  /// Phone Ed25519 identity public key.
  final Uint8List phoneIdentityPublicKey;

  /// Phone X25519 ephemeral public key.
  final Uint8List phoneEphemeralPublicKey;

  /// Random 32-byte client nonce.
  final Uint8List clientNonce;

  /// Serializes to wire JSON.
  Map<String, dynamic> toJson() => {
        'kind': kind,
        'protocolVersion': protocolVersion,
        'sessionId': sessionId,
        'handshakeMode': handshakeMode.wire,
        'phoneDeviceId': phoneDeviceId,
        'phoneIdentityPublicKey': phoneIdentityPublicKey.toHex(),
        'phoneEphemeralPublicKey': phoneEphemeralPublicKey.toHex(),
        'clientNonce': clientNonce.toHex(),
      };
}

/// `serverHello` — the bridge's response (spec 02a §5.9.1).
class ServerHello {
  /// Creates a [ServerHello].
  const ServerHello({
    required this.sessionId,
    required this.macDeviceId,
    required this.macIdentityPublicKey,
    required this.macEphemeralPublicKey,
    required this.serverNonce,
    required this.keyEpoch,
    required this.expiresAtForTranscript,
    required this.macSignature,
    required this.clientNonce,
    required this.displayName,
    this.protocolVersion = 1,
  });

  /// Parses a [ServerHello] from wire JSON.
  factory ServerHello.fromJson(Map<String, dynamic> json) => ServerHello(
        protocolVersion: json['protocolVersion'] as int? ?? 1,
        sessionId: json['sessionId'] as String,
        macDeviceId: json['macDeviceId'] as String,
        macIdentityPublicKey:
            (json['macIdentityPublicKey'] as String).fromHex(),
        macEphemeralPublicKey:
            (json['macEphemeralPublicKey'] as String).fromHex(),
        serverNonce: (json['serverNonce'] as String).fromHex(),
        keyEpoch: json['keyEpoch'] as int,
        expiresAtForTranscript: json['expiresAtForTranscript'] as int,
        macSignature: (json['macSignature'] as String).fromHex(),
        clientNonce: (json['clientNonce'] as String).fromHex(),
        displayName: json['displayName'] as String? ?? '',
      );

  /// Discriminator.
  static const String kind = 'serverHello';

  /// Protocol version.
  final int protocolVersion;

  /// Session id.
  final String sessionId;

  /// Bridge device id.
  final String macDeviceId;

  /// Bridge Ed25519 identity public key.
  final Uint8List macIdentityPublicKey;

  /// Bridge X25519 ephemeral public key.
  final Uint8List macEphemeralPublicKey;

  /// Random 32-byte server nonce.
  final Uint8List serverNonce;

  /// Key epoch.
  final int keyEpoch;

  /// Transcript expiry (Unix ms).
  final int expiresAtForTranscript;

  /// Bridge Ed25519 signature over the transcript.
  final Uint8List macSignature;

  /// Echo of the phone's client nonce.
  final Uint8List clientNonce;

  /// Bridge display name.
  final String displayName;
}

/// `clientAuth` — the phone's transcript signature (spec 02a §5.9.1).
class ClientAuth {
  /// Creates a [ClientAuth].
  const ClientAuth({
    required this.sessionId,
    required this.phoneDeviceId,
    required this.keyEpoch,
    required this.phoneSignature,
  });

  /// Discriminator.
  static const String kind = 'clientAuth';

  /// Session id.
  final String sessionId;

  /// Phone device id.
  final String phoneDeviceId;

  /// Key epoch.
  final int keyEpoch;

  /// Phone Ed25519 signature over the transcript.
  final Uint8List phoneSignature;

  /// Serializes to wire JSON.
  Map<String, dynamic> toJson() => {
        'kind': kind,
        'sessionId': sessionId,
        'phoneDeviceId': phoneDeviceId,
        'keyEpoch': keyEpoch,
        'phoneSignature': phoneSignature.toHex(),
      };
}

/// `ready` — the bridge confirms the session is established (spec 02a §5.9.1).
class Ready {
  /// Creates a [Ready].
  const Ready({
    required this.sessionId,
    required this.keyEpoch,
    required this.macDeviceId,
  });

  /// Parses a [Ready] from wire JSON.
  factory Ready.fromJson(Map<String, dynamic> json) => Ready(
        sessionId: json['sessionId'] as String,
        keyEpoch: json['keyEpoch'] as int,
        macDeviceId: json['macDeviceId'] as String,
      );

  /// Discriminator.
  static const String kind = 'ready';

  /// Session id.
  final String sessionId;

  /// Key epoch.
  final int keyEpoch;

  /// Bridge device id.
  final String macDeviceId;
}
