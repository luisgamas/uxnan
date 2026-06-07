import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

/// An Ed25519 identity key pair (persistent device identity).
class Ed25519KeyPairBytes {
  /// Creates an [Ed25519KeyPairBytes].
  const Ed25519KeyPairBytes({
    required this.publicKey,
    required this.privateSeed,
  });

  /// 32-byte Ed25519 public key.
  final Uint8List publicKey;

  /// 32-byte Ed25519 private seed (store in secure storage only).
  final Uint8List privateSeed;
}

/// An X25519 ephemeral key pair (per-handshake, never persisted).
class X25519KeyPairBytes {
  /// Creates an [X25519KeyPairBytes].
  const X25519KeyPairBytes({required this.publicKey, required this.privateKey});

  /// 32-byte X25519 public key.
  final Uint8List publicKey;

  /// 32-byte X25519 private key.
  final Uint8List privateKey;
}

/// Generates the cryptographic key material used by the E2EE protocol.
///
/// Primitives follow `architecture/02b-contracts-and-requirements.md` (section
/// 5.1): Ed25519 for identity, X25519 for ephemeral key exchange. Backed by the
/// `cryptography` package (native-accelerated on device via
/// `cryptography_flutter`).
class KeyGeneration {
  /// Creates a [KeyGeneration] helper.
  KeyGeneration();

  final Ed25519 _ed25519 = Ed25519();
  final X25519 _x25519 = X25519();
  final Random _random = Random.secure();

  /// Generates a fresh Ed25519 identity key pair.
  Future<Ed25519KeyPairBytes> generateIdentityKeyPair() async {
    final keyPair = await _ed25519.newKeyPair();
    final publicKey = await keyPair.extractPublicKey();
    final seed = await keyPair.extractPrivateKeyBytes();
    return Ed25519KeyPairBytes(
      publicKey: Uint8List.fromList(publicKey.bytes),
      privateSeed: Uint8List.fromList(seed),
    );
  }

  /// Generates a fresh X25519 ephemeral key pair for a single handshake.
  Future<X25519KeyPairBytes> generateEphemeralKeyPair() async {
    final keyPair = await _x25519.newKeyPair();
    final publicKey = await keyPair.extractPublicKey();
    final privateKey = await keyPair.extractPrivateKeyBytes();
    return X25519KeyPairBytes(
      publicKey: Uint8List.fromList(publicKey.bytes),
      privateKey: Uint8List.fromList(privateKey),
    );
  }

  /// Returns [length] cryptographically secure random bytes (nonces).
  Uint8List randomBytes(int length) {
    final bytes = Uint8List(length);
    for (var i = 0; i < length; i++) {
      bytes[i] = _random.nextInt(256);
    }
    return bytes;
  }
}
