import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/crypto/fingerprint.dart';

void main() {
  group('MessageFingerprinter', () {
    test('matches known SHA-256 digests', () {
      // SHA-256("abc").
      expect(
        MessageFingerprinter.of('abc').hash,
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
      // SHA-256("") — empty input after trim.
      expect(
        MessageFingerprinter.of('   ').hash,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });

    test('is deterministic and whitespace-normalized', () {
      expect(
        MessageFingerprinter.of('  hello world  '),
        MessageFingerprinter.of('hello world'),
      );
    });

    test('differs for different content', () {
      expect(
        MessageFingerprinter.of('a') == MessageFingerprinter.of('b'),
        isFalse,
      );
    });
  });
}
