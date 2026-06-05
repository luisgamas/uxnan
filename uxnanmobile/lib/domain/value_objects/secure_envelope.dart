import 'dart:typed_data';

import 'package:uxnan/core/extensions/uint8list_ext.dart';

/// An AES-256-GCM encrypted message on the wire.
///
/// Wire shape (spec 02a §5.9.1, phase 3): the [nonce] is hex-encoded and the
/// [ciphertext] and [tag] are base64-encoded. The relay only ever sees this
/// opaque envelope, never the plaintext.
class SecureEnvelope {
  /// Creates a [SecureEnvelope].
  const SecureEnvelope({
    required this.sessionId,
    required this.seq,
    required this.nonce,
    required this.ciphertext,
    required this.tag,
  });

  /// Reconstructs a [SecureEnvelope] from its wire JSON form.
  factory SecureEnvelope.fromJson(Map<String, dynamic> json) {
    return SecureEnvelope(
      sessionId: json['sessionId'] as String,
      seq: json['seq'] as int,
      nonce: (json['nonce'] as String).fromHex(),
      ciphertext: (json['ciphertext'] as String).fromBase64(),
      tag: (json['tag'] as String).fromBase64(),
    );
  }

  /// Session identifier this envelope belongs to.
  final String sessionId;

  /// Monotonic sequence number for replay protection.
  final int seq;

  /// Per-message GCM nonce (12 bytes).
  final Uint8List nonce;

  /// AES-256-GCM ciphertext.
  final Uint8List ciphertext;

  /// GCM authentication tag (16 bytes).
  final Uint8List tag;

  /// Discriminator value used on the wire.
  static const String kind = 'encryptedEnvelope';

  /// Serializes this envelope to its wire JSON form.
  Map<String, dynamic> toJson() => {
        'kind': kind,
        'sessionId': sessionId,
        'seq': seq,
        'nonce': nonce.toHex(),
        'ciphertext': ciphertext.toBase64(),
        'tag': tag.toBase64(),
      };
}
