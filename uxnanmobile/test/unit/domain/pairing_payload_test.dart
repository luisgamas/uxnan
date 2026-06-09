import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';

String _qr(Map<String, dynamic> json) =>
    base64.encode(utf8.encode(jsonEncode(json)));

void main() {
  final macKey = Uint8List.fromList(List<int>.generate(32, (i) => i));

  Map<String, dynamic> validJson() => {
        'v': 2,
        'relay': 'wss://relay.uxnan.io',
        'sessionId': 'session-1',
        'macDeviceId': 'mac-1',
        'macIdentityPublicKey': macKey.toHex(),
        'expiresAt': 1893456000000,
        'displayName': 'My Mac',
      };

  group('PairingPayload.fromQrString', () {
    test('parses a valid Base64 JSON QR', () {
      final payload = PairingPayload.fromQrString(_qr(validJson()));
      expect(payload.version, 2);
      expect(payload.relayUrl, 'wss://relay.uxnan.io');
      expect(payload.hosts, isEmpty);
      expect(payload.sessionId, 'session-1');
      expect(payload.macDeviceId, 'mac-1');
      expect(payload.macIdentityPublicKey, macKey);
      expect(payload.expiresAt, 1893456000000);
      expect(payload.displayName, 'My Mac');
    });

    test('parses direct hosts and tolerates a missing relay', () {
      final json = validJson()
        ..remove('relay')
        ..['hosts'] = ['192.168.1.5:8765', '100.64.0.2:8765'];
      final payload = PairingPayload.fromQrString(_qr(json));
      expect(payload.relayUrl, isEmpty);
      expect(payload.hosts, ['192.168.1.5:8765', '100.64.0.2:8765']);
    });

    test('parses both relay and hosts when present', () {
      final json = validJson()..['hosts'] = ['192.168.1.5:8765'];
      final payload = PairingPayload.fromQrString(_qr(json));
      expect(payload.relayUrl, 'wss://relay.uxnan.io');
      expect(payload.hosts, ['192.168.1.5:8765']);
    });

    test('throws FormatException when hosts is not a list', () {
      final json = validJson()..['hosts'] = 'nope';
      expect(
        () => PairingPayload.fromQrString(_qr(json)),
        throwsFormatException,
      );
    });

    test('throws FormatException when a host entry is not a string', () {
      final json = validJson()..['hosts'] = [123];
      expect(
        () => PairingPayload.fromQrString(_qr(json)),
        throwsFormatException,
      );
    });

    test('throws FormatException on non-Base64 input', () {
      expect(
        () => PairingPayload.fromQrString('not base64 !!!'),
        throwsFormatException,
      );
    });

    test('throws FormatException when a field is missing', () {
      final json = validJson()..remove('sessionId');
      expect(
        () => PairingPayload.fromQrString(_qr(json)),
        throwsFormatException,
      );
    });

    test('throws FormatException when a field has the wrong type', () {
      final json = validJson()..['v'] = 'two';
      expect(
        () => PairingPayload.fromQrString(_qr(json)),
        throwsFormatException,
      );
    });
  });
}
