import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/value_objects/secure_envelope.dart';

/// Authenticated encryption of message envelopes with AES-256-GCM.
///
/// Wire format per `architecture/02a-system-architecture.md` (section 5.9.1,
/// phase 3): a random 12-byte nonce per message and a 16-byte GCM tag. The
/// algorithm and parameters are fixed by the spec — no variants.
///
/// [aad] (Additional Authenticated Data) binds fields that travel in the
/// plain envelope — `sessionId`, `seq`, the sending direction — to the GCM
/// tag without encrypting them, so a receiver needs them to look up the key
/// but any tamper of them fails authentication (see
/// `SecureTransportLayer.buildEnvelopeAad`). Callers that don't need AAD may
/// omit it (defaults to empty, matching the previous behavior).
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
    List<int> aad = const [],
  }) async {
    final secretBox = await _aesGcm.encrypt(
      plaintext,
      secretKey: SecretKey(key),
      nonce: nonce,
      aad: aad,
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
  /// [aad] must equal what was passed to [encrypt], including empty/omitted.
  ///
  /// Throws a [TransportException] of kind [TransportErrorKind.decryption] if
  /// authentication fails (tampered ciphertext, wrong key, wrong nonce, or a
  /// mismatched [aad]).
  Future<Uint8List> decrypt({
    required SecureEnvelope envelope,
    required Uint8List key,
    List<int> aad = const [],
  }) async {
    final secretBox = SecretBox(
      envelope.ciphertext,
      nonce: envelope.nonce,
      mac: Mac(envelope.tag),
    );
    try {
      final clear = await _aesGcm.decrypt(
        secretBox,
        secretKey: SecretKey(key),
        aad: aad,
      );
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
