import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:uxnan/core/constants/protocol_constants.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';

/// The values signed during the handshake to bind both parties' ephemeral keys.
///
/// Field order matches `architecture/02a-system-architecture.md` (section
/// 5.9.1): `clientNonce || phoneEphemeralPublicKey || macEphemeralPublicKey ||
/// serverNonce || sessionId || keyEpoch || expiresAtForTranscript`.
class HandshakeTranscriptInput {
  /// Creates a [HandshakeTranscriptInput].
  const HandshakeTranscriptInput({
    required this.clientNonce,
    required this.phoneEphemeralPublicKey,
    required this.macEphemeralPublicKey,
    required this.serverNonce,
    required this.sessionId,
    required this.keyEpoch,
    required this.expiresAtForTranscript,
  });

  /// 32-byte random nonce chosen by the phone.
  final Uint8List clientNonce;

  /// Phone's X25519 ephemeral public key.
  final Uint8List phoneEphemeralPublicKey;

  /// Bridge's X25519 ephemeral public key.
  final Uint8List macEphemeralPublicKey;

  /// 32-byte random nonce chosen by the bridge.
  final Uint8List serverNonce;

  /// Session identifier.
  final String sessionId;

  /// Key renegotiation counter.
  final int keyEpoch;

  /// Transcript expiry as Unix milliseconds.
  final int expiresAtForTranscript;
}

/// Cryptographic operations of the E2EE handshake (spec 02a §5.9.1).
///
/// Uses Ed25519 for bilateral transcript signatures and X25519 + HKDF-SHA256 to
/// derive the AES-256 session key. No cryptographic variants are introduced.
class HandshakeCrypto {
  /// Creates a [HandshakeCrypto] helper.
  HandshakeCrypto();

  final Ed25519 _ed25519 = Ed25519();
  final X25519 _x25519 = X25519();
  final Hkdf _hkdf = Hkdf(hmac: Hmac.sha256(), outputLength: 32);

  /// Builds the canonical transcript bytes that both parties sign.
  ///
  /// Canonical encoding (contract the bridge must mirror): the wire-format
  /// string of each field is concatenated in the documented order — lowercase
  /// hex for the byte fields, the raw string for `sessionId`, and the decimal
  /// representation for the integer fields — and the result is UTF-8 encoded.
  Uint8List buildTranscript(HandshakeTranscriptInput input) {
    final buffer = StringBuffer()
      ..write(input.clientNonce.toHex())
      ..write(input.phoneEphemeralPublicKey.toHex())
      ..write(input.macEphemeralPublicKey.toHex())
      ..write(input.serverNonce.toHex())
      ..write(input.sessionId)
      ..write(input.keyEpoch)
      ..write(input.expiresAtForTranscript);
    return Uint8List.fromList(utf8.encode(buffer.toString()));
  }

  /// Signs [transcript] with the Ed25519 [privateSeed], returning 64 bytes.
  Future<Uint8List> sign(Uint8List transcript, Uint8List privateSeed) async {
    final keyPair = await _ed25519.newKeyPairFromSeed(privateSeed);
    final signature = await _ed25519.sign(transcript, keyPair: keyPair);
    return Uint8List.fromList(signature.bytes);
  }

  /// Verifies an Ed25519 [signature] over [transcript] against [publicKey].
  Future<bool> verify(
    Uint8List transcript,
    Uint8List signature,
    Uint8List publicKey,
  ) async {
    final sig = Signature(
      signature,
      publicKey: SimplePublicKey(publicKey, type: KeyPairType.ed25519),
    );
    return _ed25519.verify(transcript, signature: sig);
  }

  /// Derives the 32-byte AES-256 session key from the X25519 shared secret.
  ///
  /// `salt = clientNonce || serverNonce`, `info = "uxnan-e2ee-v1"`
  /// (spec §5.9.1).
  Future<Uint8List> deriveSessionKey({
    required Uint8List phoneEphemeralPrivateKey,
    required Uint8List macEphemeralPublicKey,
    required Uint8List clientNonce,
    required Uint8List serverNonce,
  }) async {
    final keyPair = await _x25519.newKeyPairFromSeed(phoneEphemeralPrivateKey);
    final sharedSecret = await _x25519.sharedSecretKey(
      keyPair: keyPair,
      remotePublicKey:
          SimplePublicKey(macEphemeralPublicKey, type: KeyPairType.x25519),
    );
    final sharedBytes = await sharedSecret.extractBytes();
    final salt = <int>[...clientNonce, ...serverNonce];
    final derived = await _hkdf.deriveKey(
      secretKey: SecretKey(sharedBytes),
      nonce: salt,
      info: utf8.encode(ProtocolConstants.hkdfInfoTag),
    );
    final keyBytes = await derived.extractBytes();
    return Uint8List.fromList(keyBytes);
  }
}
