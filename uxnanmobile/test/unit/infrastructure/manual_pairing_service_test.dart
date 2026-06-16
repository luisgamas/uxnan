import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/pairing/manual_pairing_service.dart';

void main() {
  group('normalizeHostInput', () {
    test('appends the default bridge port to a bare host', () {
      expect(normalizeHostInput('192.168.1.5'), '192.168.1.5:19850');
    });

    test('keeps an explicit host:port', () {
      expect(normalizeHostInput('192.168.1.5:8080'), '192.168.1.5:8080');
    });

    test('strips a scheme and any path/query', () {
      expect(normalizeHostInput('http://10.0.0.2:7000/pair'), '10.0.0.2:7000');
      expect(normalizeHostInput('ws://host.local:9000?x=1'), 'host.local:9000');
    });

    test('returns null for empty input or an invalid port', () {
      expect(normalizeHostInput('   '), isNull);
      expect(normalizeHostInput('host:notaport'), isNull);
      expect(normalizeHostInput('host:99999'), isNull);
      expect(normalizeHostInput('host:0'), isNull);
    });
  });

  group('buildPairResolveUri', () {
    test('builds the GET /pair/resolve URL with an encoded code', () {
      final uri = buildPairResolveUri('192.168.1.5:19850', 'A B+C');
      expect(uri.scheme, 'http');
      expect(uri.host, '192.168.1.5');
      expect(uri.port, 19850);
      expect(uri.path, '/pair/resolve');
      expect(uri.queryParameters['code'], 'A B+C');
    });
  });

  group('parsePairResolveResponse', () {
    final validPayload = <String, dynamic>{
      'v': 1,
      'sessionId': 'sess-1',
      'macDeviceId': 'dev-1',
      'macIdentityPublicKey':
          '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      'expiresAt': 9999999999999,
      'displayName': 'My PC',
      'hosts': <String>['192.168.1.5:19850'],
    };

    test('200 with a valid body decodes to a PairingPayload', () {
      final payload = parsePairResolveResponse(200, validPayload);
      expect(payload.displayName, 'My PC');
      expect(payload.sessionId, 'sess-1');
      expect(payload.hosts, ['192.168.1.5:19850']);
      expect(payload.macIdentityPublicKey.length, 32);
    });

    test('200 with a JSON string body is decoded too', () {
      final payload = parsePairResolveResponse(
        200,
        '{"v":1,"sessionId":"s","macDeviceId":"d","macIdentityPublicKey":'
        '"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",'
        '"expiresAt":1,"displayName":"PC"}',
      );
      expect(payload.displayName, 'PC');
    });

    test('200 with a non-object / garbage body throws malformedPayload', () {
      expect(
        () => parsePairResolveResponse(200, 'not json'),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.malformedPayload,
          ),
        ),
      );
      expect(
        () => parsePairResolveResponse(200, <String, dynamic>{'v': 1}),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.malformedPayload,
          ),
        ),
      );
    });

    test('maps error status codes to kinds', () {
      expect(
        () => parsePairResolveResponse(403, null),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.invalidOrExpiredCode,
          ),
        ),
      );
      expect(
        () => parsePairResolveResponse(429, null),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.rateLimited,
          ),
        ),
      );
      expect(
        () => parsePairResolveResponse(500, null),
        throwsA(
          isA<ManualPairingException>()
              .having((e) => e.kind, 'kind', ManualPairingErrorKind.server),
        ),
      );
    });
  });
}
