import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';
import 'package:uxnan/domain/services/pairing_validator.dart';

void main() {
  const validator = PairingValidator();
  final macKey = Uint8List.fromList(List<int>.generate(32, (i) => i + 1));

  PairingPayload payload({
    int version = 2,
    int? expiresAt,
    String sessionId = 'session-1',
    String relayUrl = 'wss://relay.uxnan.io',
    List<String> hosts = const [],
    Uint8List? key,
  }) =>
      PairingPayload(
        version: version,
        relayUrl: relayUrl,
        hosts: hosts,
        sessionId: sessionId,
        macDeviceId: 'mac-1',
        macIdentityPublicKey: key ?? macKey,
        expiresAt: expiresAt ??
            DateTime.now()
                .add(const Duration(minutes: 5))
                .millisecondsSinceEpoch,
        displayName: 'My Mac',
      );

  group('PairingValidator.validatePayload', () {
    test('accepts a well-formed, unexpired, v2 payload', () {
      final result = validator.validatePayload(payload());
      expect(result.isValid, isTrue);
      expect(result.status, PairingValidationStatus.valid);
      expect(result.payload, isNotNull);
    });

    test('rejects an unsupported QR version', () {
      final result = validator.validatePayload(payload(version: 1));
      expect(result.status, PairingValidationStatus.unsupportedVersion);
      expect(result.isValid, isFalse);
    });

    test('rejects an expired payload (beyond skew tolerance)', () {
      final result = validator.validatePayload(
        payload(
          expiresAt: DateTime.now()
              .subtract(const Duration(minutes: 5))
              .millisecondsSinceEpoch,
        ),
      );
      expect(result.status, PairingValidationStatus.expired);
    });

    test('rejects a payload with missing required fields', () {
      final result = validator.validatePayload(payload(sessionId: ''));
      expect(result.status, PairingValidationStatus.malformed);
    });

    test('accepts a hosts-only payload (no relay)', () {
      final result = validator.validatePayload(
        payload(relayUrl: '', hosts: const ['192.168.1.5:8765']),
      );
      expect(result.isValid, isTrue);
    });

    test('rejects a payload advertising no transport', () {
      final result = validator.validatePayload(payload(relayUrl: ''));
      expect(result.status, PairingValidationStatus.malformed);
    });
  });

  group('PairingValidator.validate (raw QR)', () {
    test('reports malformed for non-Base64 input', () {
      final result = validator.validate('@@@not-base64@@@');
      expect(result.status, PairingValidationStatus.malformed);
      expect(result.reason, isNotNull);
    });
  });
}
