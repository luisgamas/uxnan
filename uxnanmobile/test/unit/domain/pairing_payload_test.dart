import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';

String _qr(Map<String, dynamic> json) =>
    base64.encode(utf8.encode(jsonEncode(json)));

void main() {
  final macKey = Uint8List.fromList(List<int>.generate(32, (i) => i));

  const routingId = '0123456789abcdef0123456789abcdef';
  // 32 bytes, base64url without padding: 43 chars.
  const ticket = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const relay = RelayEndpoint(
    url: 'wss://uxnan-relay.example.workers.dev',
    routingId: routingId,
    enabled: true,
  );

  Map<String, dynamic> validJson() => {
        'v': 3,
        'relay': {
          'url': 'wss://uxnan-relay.example.workers.dev',
          'routingId': routingId,
        },
        'sessionId': 'session-1',
        'macDeviceId': 'mac-1',
        'macIdentityPublicKey': macKey.toHex(),
        'expiresAt': 1893456000000,
        'displayName': 'My Mac',
      };

  group('PairingPayload.fromQrString', () {
    test('parses a valid Base64 JSON QR', () {
      final payload = PairingPayload.fromQrString(_qr(validJson()));
      expect(payload.version, 3);
      // The QR only advertises a relay the bridge is serving phones through.
      expect(payload.relay, relay);
      expect(payload.relayTicket, isNull);
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
      expect(payload.relay, isNull);
      expect(payload.hosts, ['192.168.1.5:8765', '100.64.0.2:8765']);
    });

    test('parses both relay and hosts when present', () {
      final json = validJson()..['hosts'] = ['192.168.1.5:8765'];
      final payload = PairingPayload.fromQrString(_qr(json));
      expect(payload.relay, relay);
      expect(payload.hosts, ['192.168.1.5:8765']);
    });

    test("keeps the relay's one-time pairing ticket apart from the relay", () {
      final json = validJson();
      (json['relay'] as Map<String, dynamic>)['ticket'] = ticket;
      final payload = PairingPayload.fromQrString(_qr(json));
      expect(payload.relay, relay);
      expect(payload.relayTicket, ticket);
    });

    test('accepts a relay on a port (a relay run locally)', () {
      final json = validJson()
        ..['relay'] = {'url': 'ws://127.0.0.1:8787', 'routingId': routingId};
      final payload = PairingPayload.fromQrString(_qr(json));
      expect(payload.relay?.url, 'ws://127.0.0.1:8787');
    });

    for (final (name, bad) in <(String, Object)>[
      ('a bare URL string (the v2 shape)', 'wss://relay.example'),
      (
        'a URL with a path',
        {'url': 'wss://relay.example/v1', 'routingId': routingId},
      ),
      (
        'a non-wss URL',
        {'url': 'https://relay.example', 'routingId': routingId}
      ),
      (
        'an uppercase routing id',
        {'url': 'wss://relay.example', 'routingId': routingId.toUpperCase()},
      ),
      ('a short routing id', {'url': 'wss://relay.example', 'routingId': 'ab'}),
      (
        'a malformed ticket',
        {
          'url': 'wss://relay.example',
          'routingId': routingId,
          'ticket': 'too-short',
        },
      ),
    ]) {
      test('throws FormatException for a relay that is $name', () {
        final json = validJson()..['relay'] = bad;
        expect(
          () => PairingPayload.fromQrString(_qr(json)),
          throwsFormatException,
        );
      });
    }

    test('parses a v2 QR without its relay, for the version check', () {
      final json = validJson()
        ..['v'] = 2
        ..['relay'] = 'wss://relay.example';
      final payload = PairingPayload.fromQrString(_qr(json));
      expect(payload.version, 2);
      expect(payload.relay, isNull);
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
