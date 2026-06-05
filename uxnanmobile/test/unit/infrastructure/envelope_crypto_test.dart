import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/value_objects/secure_envelope.dart';
import 'package:uxnan/infrastructure/crypto/envelope_crypto.dart';

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
  });
}
