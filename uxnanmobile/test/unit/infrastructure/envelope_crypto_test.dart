import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/value_objects/secure_envelope.dart';
import 'package:uxnan/infrastructure/crypto/envelope_crypto.dart';
import 'package:uxnan/infrastructure/transport/secure_transport_layer.dart'
    show buildEnvelopeAad, directionBridgeToPhone, directionPhoneToBridge;

/// Cross-language AES-256-GCM + AAD interop vector.
///
/// Fixed (key, nonce, plaintext, sessionId="abc", seq=1, direction=phone→bridge
/// 0x01) → (ciphertext, tag), computed once with Node's `crypto` (the same
/// AES-256-GCM primitives `bridge/src/transport/crypto.ts`'s `aesGcmEncrypt`
/// uses; see `bridge/test/transport/crypto.test.ts`, kept byte-for-byte
/// identical here) so this test proves `EnvelopeCrypto.decrypt` (via the
/// `cryptography` package's `AesGcm`) consumes bridge-produced
/// ciphertext/tag/AAD correctly — the decisive proof that bridge-encrypt /
/// mobile-decrypt interoperate, not just that each side round-trips against
/// itself.
final _vectorKey = Uint8List(32)..fillRange(0, 32, 0x42);
final _vectorNonce = Uint8List(12)..fillRange(0, 12, 0x24);
const _vectorSessionId = 'abc';
const _vectorSeq = 1;
const _vectorPlaintext = 'uxnan-e2ee-aad-vector';
final _vectorCiphertext =
    '60e9aa2087eba30c438d0fcbdc56bed00998471fc4'.fromHex();
final _vectorTag = '137402451a5fbbea7ed20367742e6339'.fromHex();

void main() {
  final envelopeCrypto = EnvelopeCrypto();

  group('AES-256-GCM envelope', () {
    test('matches the NIST all-zero AES-256-GCM test vector', () async {
      // Key = 32x00, IV = 12x00, no AAD, empty plaintext
      // => empty ciphertext, tag = 530f8afbc74536b9a963b4f1c4cb738b.
      final key = Uint8List(32);
      final nonce = Uint8List(12);
      final envelope = await envelopeCrypto.encrypt(
        plaintext: Uint8List(0),
        key: key,
        sessionId: 's',
        seq: 0,
        nonce: nonce,
      );
      expect(envelope.ciphertext, isEmpty);
      expect(envelope.tag.toHex(), '530f8afbc74536b9a963b4f1c4cb738b');
    });

    test('encrypt then decrypt round-trips', () async {
      final key = '00112233445566778899aabbccddeeff'
              '00112233445566778899aabbccddeeff'
          .fromHex();
      final plaintext = Uint8List.fromList('hola mundo E2EE'.codeUnits);

      final envelope = await envelopeCrypto.encrypt(
        plaintext: plaintext,
        key: key,
        sessionId: 'session-1',
        seq: 7,
      );
      expect(envelope.nonce.length, 12);
      expect(envelope.tag.length, 16);
      expect(envelope.seq, 7);

      final decrypted =
          await envelopeCrypto.decrypt(envelope: envelope, key: key);
      expect(decrypted, plaintext);
    });

    test('survives a wire round-trip (toJson/fromJson)', () async {
      final key = Uint8List(32)..[0] = 9;
      final plaintext = Uint8List.fromList([10, 20, 30, 40]);
      final envelope = await envelopeCrypto.encrypt(
        plaintext: plaintext,
        key: key,
        sessionId: 'abc',
        seq: 3,
      );

      final restored = SecureEnvelope.fromJson(envelope.toJson());
      final decrypted =
          await envelopeCrypto.decrypt(envelope: restored, key: key);
      expect(decrypted, plaintext);
    });

    test('rejects a tampered ciphertext with a decryption error', () async {
      final key = Uint8List(32)..[1] = 5;
      final envelope = await envelopeCrypto.encrypt(
        plaintext: Uint8List.fromList([1, 2, 3, 4]),
        key: key,
        sessionId: 's',
        seq: 1,
      );
      final tampered = SecureEnvelope(
        sessionId: envelope.sessionId,
        seq: envelope.seq,
        nonce: envelope.nonce,
        ciphertext: Uint8List.fromList(envelope.ciphertext)..[0] ^= 0xff,
        tag: envelope.tag,
      );

      expect(
        () => envelopeCrypto.decrypt(envelope: tampered, key: key),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.decryption,
          ),
        ),
      );
    });

    test('rejects decryption under the wrong key', () async {
      final key = Uint8List(32)..[2] = 1;
      final wrongKey = Uint8List(32)..[2] = 2;
      final envelope = await envelopeCrypto.encrypt(
        plaintext: Uint8List.fromList([9, 9, 9]),
        key: key,
        sessionId: 's',
        seq: 1,
      );
      expect(
        () => envelopeCrypto.decrypt(envelope: envelope, key: wrongKey),
        throwsA(isA<TransportException>()),
      );
    });

    test('round-trips with AAD when the same AAD is presented on decrypt',
        () async {
      final key = Uint8List(32)..[3] = 7;
      final aad = buildEnvelopeAad('sess-1', 1, directionPhoneToBridge);
      final envelope = await envelopeCrypto.encrypt(
        plaintext: Uint8List.fromList([1, 2, 3]),
        key: key,
        sessionId: 'sess-1',
        seq: 1,
        aad: aad,
      );
      final decrypted = await envelopeCrypto.decrypt(
        envelope: envelope,
        key: key,
        aad: aad,
      );
      expect(decrypted, [1, 2, 3]);
    });

    test(
        'decryption fails when the AAD differs from encrypt (direction '
        'mismatch)', () async {
      final key = Uint8List(32)..[4] = 8;
      final encryptAad = buildEnvelopeAad('sess-1', 1, directionPhoneToBridge);
      final envelope = await envelopeCrypto.encrypt(
        plaintext: Uint8List.fromList([1, 2, 3]),
        key: key,
        sessionId: 'sess-1',
        seq: 1,
        aad: encryptAad,
      );
      // Same sessionId/seq but the OPPOSITE direction byte: simulates a
      // reflected envelope fed to the wrong side.
      final decryptAad = buildEnvelopeAad('sess-1', 1, directionBridgeToPhone);
      expect(
        () => envelopeCrypto.decrypt(
          envelope: envelope,
          key: key,
          aad: decryptAad,
        ),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.decryption,
          ),
        ),
      );
    });

    test(
        'cross-language vector: decrypts the bridge-generated '
        'ciphertext/tag/AAD byte-for-byte', () async {
      final aad = buildEnvelopeAad(
        _vectorSessionId,
        _vectorSeq,
        directionPhoneToBridge,
      );
      expect(aad.toHex(), '6162630000000000000000010001');

      final envelope = SecureEnvelope(
        sessionId: _vectorSessionId,
        seq: _vectorSeq,
        nonce: _vectorNonce,
        ciphertext: _vectorCiphertext,
        tag: _vectorTag,
      );
      final decrypted = await envelopeCrypto.decrypt(
        envelope: envelope,
        key: _vectorKey,
        aad: aad,
      );
      expect(String.fromCharCodes(decrypted), _vectorPlaintext);
    });
  });
}
