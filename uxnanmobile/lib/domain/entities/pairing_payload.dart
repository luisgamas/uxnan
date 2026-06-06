import 'dart:convert';
import 'dart:typed_data';

import 'package:equatable/equatable.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';

/// The data carried in a bridge pairing QR code.
///
/// Transported as Base64-encoded JSON (spec 02a §5.5.4). `version` is the QR
/// format version (`PAIRING_QR_VERSION` = 2). Validation lives in
/// `PairingValidator`; this type only parses.
class PairingPayload extends Equatable {
  /// Creates a [PairingPayload].
  const PairingPayload({
    required this.version,
    required this.relayUrl,
    required this.sessionId,
    required this.macDeviceId,
    required this.macIdentityPublicKey,
    required this.expiresAt,
    required this.displayName,
  });

  /// Parses a [PairingPayload] from a raw Base64 QR string.
  ///
  /// Throws a [FormatException] if the string is not valid Base64 JSON or a
  /// required field is missing or malformed.
  factory PairingPayload.fromQrString(String qr) {
    final decoded = utf8.decode(base64.decode(base64.normalize(qr.trim())));
    final json = jsonDecode(decoded);
    if (json is! Map) {
      throw const FormatException('Pairing payload is not a JSON object');
    }
    return PairingPayload.fromJson(json.cast<String, dynamic>());
  }

  /// Parses a [PairingPayload] from its decoded JSON map.
  factory PairingPayload.fromJson(Map<String, dynamic> json) {
    T field<T>(String key) {
      final value = json[key];
      if (value is! T) {
        throw FormatException('Missing or invalid pairing field: $key');
      }
      return value;
    }

    return PairingPayload(
      version: field<int>('v'),
      relayUrl: field<String>('relay'),
      sessionId: field<String>('sessionId'),
      macDeviceId: field<String>('macDeviceId'),
      macIdentityPublicKey: field<String>('macIdentityPublicKey').fromHex(),
      expiresAt: field<int>('expiresAt'),
      displayName: field<String>('displayName'),
    );
  }

  /// QR format version.
  final int version;

  /// Relay URL the bridge is reachable through.
  final String relayUrl;

  /// Session id to use for the connection.
  final String sessionId;

  /// Bridge device id.
  final String macDeviceId;

  /// Bridge Ed25519 identity public key (32 bytes).
  final Uint8List macIdentityPublicKey;

  /// Expiry as Unix epoch milliseconds.
  final int expiresAt;

  /// Human readable bridge name.
  final String displayName;

  /// The expiry instant (UTC).
  DateTime get expiresAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(expiresAt, isUtc: true);

  @override
  List<Object?> get props => [
        version,
        relayUrl,
        sessionId,
        macDeviceId,
        macIdentityPublicKey,
        expiresAt,
        displayName,
      ];
}
