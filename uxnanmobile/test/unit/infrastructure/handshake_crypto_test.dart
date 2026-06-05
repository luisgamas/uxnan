import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/infrastructure/crypto/handshake_crypto.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';

void main() {
  final crypto = HandshakeCrypto();
  final keygen = KeyGeneration();

  group('Ed25519 transcript signatures (RFC 8032)', () {
    // RFC 8032, section 7.1, TEST 1 (empty message).
    final publicKey =
        'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
            .fromHex();
    final signature =
        'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e0652249'
                '01555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe2465514'
                '1438e7a100b'
            .fromHex();

    test('verifies the RFC 8032 test vector signature', () async {
      final ok = await crypto.verify(Uint8List(0), signature, publicKey);
      expect(ok, isTrue);
    });

    test('rejects a tampered signature', () async {
      final bad = Uint8List.fromList(signature)..[0] ^= 0xff;
      expect(await crypto.verify(Uint8List(0), bad, publicKey), isFalse);
    });

    test('sign then verify round-trips for a generated identity', () async {
      final id = await keygen.generateIdentityKeyPair();
      final message = Uint8List.fromList([1, 2, 3, 4, 5]);
      final sig = await crypto.sign(message, id.privateSeed);
      expect(sig.length, 64);
      expect(await crypto.verify(message, sig, id.publicKey), isTrue);
      // A different message must not verify against the same signature.
      final other = Uint8List.fromList([1, 2, 3, 4, 6]);
      expect(await crypto.verify(other, sig, id.publicKey), isFalse);
    });
  });

  group('X25519 key agreement (RFC 7748)', () {
    // RFC 7748, section 6.1.
    final alicePrivate =
        '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'
            .fromHex();
    final alicePublic =
        '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a'
            .fromHex();
    final bobPublic =
        'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f'
            .fromHex();
    final expectedShared =
        '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'
            .fromHex();

    test('derives the RFC 7748 public key and shared secret', () async {
      final x25519 = X25519();
      final aliceKp = await x25519.newKeyPairFromSeed(alicePrivate);
      final derivedPub = await aliceKp.extractPublicKey();
      expect(Uint8List.fromList(derivedPub.bytes), alicePublic);

      final shared = await x25519.sharedSecretKey(
        keyPair: aliceKp,
        remotePublicKey: SimplePublicKey(bobPublic, type: KeyPairType.x25519),
      );
      expect(Uint8List.fromList(await shared.extractBytes()), expectedShared);
    });
  });

  group('HKDF-SHA256 (RFC 5869)', () {
    test('matches RFC 5869 test case 1', () async {
      final ikm = Uint8List.fromList(List.filled(22, 0x0b));
      final salt = '000102030405060708090a0b0c'.fromHex();
      final info = 'f0f1f2f3f4f5f6f7f8f9'.fromHex();
      final expected =
          '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf'
                  '34007208d5b887185865'
              .fromHex();

      final hkdf = Hkdf(hmac: Hmac.sha256(), outputLength: 42);
      final okm = await hkdf.deriveKey(
        secretKey: SecretKey(ikm),
        nonce: salt,
        info: info,
      );
      expect(Uint8List.fromList(await okm.extractBytes()), expected);
    });
  });

  group('full two-party handshake', () {
    test('both sides derive the same 32-byte session key', () async {
      // Phone and bridge each generate identity + ephemeral key material.
      final phoneId = await keygen.generateIdentityKeyPair();
      final phoneEph = await keygen.generateEphemeralKeyPair();
      final bridgeId = await keygen.generateIdentityKeyPair();
      final bridgeEph = await keygen.generateEphemeralKeyPair();

      final clientNonce = keygen.randomBytes(32);
      final serverNonce = keygen.randomBytes(32);
      const sessionId = 'session-abc';
      const keyEpoch = 1;
      const expiresAt = 1893456000000;

      final input = HandshakeTranscriptInput(
        clientNonce: clientNonce,
        phoneEphemeralPublicKey: phoneEph.publicKey,
        macEphemeralPublicKey: bridgeEph.publicKey,
        serverNonce: serverNonce,
        sessionId: sessionId,
        keyEpoch: keyEpoch,
        expiresAtForTranscript: expiresAt,
      );
      final transcript = crypto.buildTranscript(input);

      // Bilateral signatures over the same transcript.
      final macSig = await crypto.sign(transcript, bridgeId.privateSeed);
      expect(
        await crypto.verify(transcript, macSig, bridgeId.publicKey),
        isTrue,
      );
      final phoneSig = await crypto.sign(transcript, phoneId.privateSeed);
      expect(
        await crypto.verify(transcript, phoneSig, phoneId.publicKey),
        isTrue,
      );

      // Each side derives the session key from its own ephemeral private key
      // and the peer's ephemeral public key.
      final phoneKey = await crypto.deriveSessionKey(
        phoneEphemeralPrivateKey: phoneEph.privateKey,
        macEphemeralPublicKey: bridgeEph.publicKey,
        clientNonce: clientNonce,
        serverNonce: serverNonce,
      );
      final bridgeKey = await crypto.deriveSessionKey(
        phoneEphemeralPrivateKey: bridgeEph.privateKey,
        macEphemeralPublicKey: phoneEph.publicKey,
        clientNonce: clientNonce,
        serverNonce: serverNonce,
      );

      expect(phoneKey.length, 32);
      expect(phoneKey, bridgeKey);
    });

    test('a tampered transcript fails signature verification', () async {
      final id = await keygen.generateIdentityKeyPair();
      final eph = await keygen.generateEphemeralKeyPair();
      final input = HandshakeTranscriptInput(
        clientNonce: keygen.randomBytes(32),
        phoneEphemeralPublicKey: eph.publicKey,
        macEphemeralPublicKey: eph.publicKey,
        serverNonce: keygen.randomBytes(32),
        sessionId: 's',
        keyEpoch: 1,
        expiresAtForTranscript: 1,
      );
      final transcript = crypto.buildTranscript(input);
      final sig = await crypto.sign(transcript, id.privateSeed);

      final tampered = Uint8List.fromList(transcript)..[0] ^= 0xff;
      expect(await crypto.verify(tampered, sig, id.publicKey), isFalse);
    });
  });
}
