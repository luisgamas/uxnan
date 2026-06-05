import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/value_objects/secure_envelope.dart';

/// Authenticated encryption of message envelopes with AES-256-GCM.
///
/// Wire format per `architecture/02a-system-architecture.md` (section 5.9.1,
/// phase 3): a random 12-byte nonce per message and a 16-byte GCM tag. The
/// algorithm and parameters are fixed by the spec — no variants.
class EnvelopeCrypto {
  /// Creates an [EnvelopeCrypto] helper.
  EnvelopeCrypto();

  final AesGcm _aesGcm = AesGcm.with256bits();

  /// Encrypts [plaintext] under [key] into a [SecureEnvelope] tagged with
  /// [sessionId] and [seq]. A fresh random nonce is generated unless [nonce]
  /// is supplied (test use only).
  Future<SecureEnvelope> encrypt({
    required Uint8List plaintext,
    required Uint8List key,
    required String sessionId,
    required int seq,
    Uint8List? nonce,
  }) async {
    final secretBox = await _aesGcm.encrypt(
      plaintext,
      secretKey: SecretKey(key),
      nonce: nonce,
    );
    return SecureEnvelope(
      sessionId: sessionId,
      seq: seq,
      nonce: Uint8List.fromList(secretBox.nonce),
      ciphertext: Uint8List.fromList(secretBox.cipherText),
      tag: Uint8List.fromList(secretBox.mac.bytes),
    );
  }

  /// Decrypts [envelope] under [key], returning the plaintext.
  ///
  /// Throws a [TransportException] of kind [TransportErrorKind.decryption] if
  /// authentication fails (tampered ciphertext, wrong key, or wrong nonce).
  Future<Uint8List> decrypt({
    required SecureEnvelope envelope,
    required Uint8List key,
  }) async {
    final secretBox = SecretBox(
      envelope.ciphertext,
      nonce: envelope.nonce,
      mac: Mac(envelope.tag),
    );
    try {
      final clear = await _aesGcm.decrypt(secretBox, secretKey: SecretKey(key));
      return Uint8List.fromList(clear);
    } on SecretBoxAuthenticationError catch (e) {
      throw TransportException(
        TransportErrorKind.decryption,
        'Envelope authentication failed (seq ${envelope.seq})',
        cause: e,
      );
    }
  }
}
