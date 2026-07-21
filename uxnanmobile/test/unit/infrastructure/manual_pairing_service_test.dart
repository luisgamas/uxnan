import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/pairing/manual_pairing_service.dart';

/// A canned HTTP response for [_FakeAdapter].
class _FakeResponse {
  const _FakeResponse({required this.statusCode, this.body});

  final int statusCode;
  final Object? body;
}

/// A minimal [HttpClientAdapter] that answers per-host from [responses] and
/// counts how many requests each host received, so it can be asserted that the
/// pairing code goes to exactly one host. A host absent from
/// [responses] simulates "unreachable" (throws a [DioException]), matching
/// what a real timed-out/refused connection surfaces to [ManualPairingService].
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.responses);

  final Map<String, _FakeResponse> responses;
  final Map<String, int> callCounts = {};

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final host = options.uri.host;
    callCounts[host] = (callCounts[host] ?? 0) + 1;
    final response = responses[host];
    if (response == null) {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.connectionError,
        message: 'no fake route for $host',
      );
    }
    return ResponseBody.fromBytes(
      utf8.encode(jsonEncode(response.body)),
      response.statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

/// A valid decoded `/pair/resolve` body, shared by [parsePairResolveResponse]
/// and [ManualPairingService.resolve] tests below.
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

  group('ManualPairingService.resolve — the code reaches ONE host only', () {
    test('dials exactly the host it was given, and no other', () async {
      final adapter = _FakeAdapter({
        'pc.local': _FakeResponse(statusCode: 200, body: validPayload),
        // A second bridge that is reachable and would happily answer. It must
        // never be dialed: mDNS records are unauthenticated, so fanning the
        // code out to a discovered host would disclose it to whoever published
        // that record and let the first responder impersonate the PC.
        'rogue.local': _FakeResponse(statusCode: 200, body: validPayload),
      });
      final dio = Dio()..httpClientAdapter = adapter;

      final payload = await ManualPairingService(dio)
          .resolve(host: 'pc.local', code: '0123-ABCD');

      expect(payload.sessionId, 'sess-1');
      expect(adapter.callCounts['pc.local'], 1);
      expect(adapter.callCounts.containsKey('rogue.local'), isFalse);
    });

    test('an unreachable host fails as network, without trying anywhere else',
        () async {
      final adapter = _FakeAdapter({
        'rogue.local': _FakeResponse(statusCode: 200, body: validPayload),
      });
      final dio = Dio()..httpClientAdapter = adapter;

      await expectLater(
        ManualPairingService(dio).resolve(host: 'pc.local', code: '0123-ABCD'),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.network,
          ),
        ),
      );
      expect(adapter.callCounts.containsKey('rogue.local'), isFalse);
    });

    test('an empty host is rejected before any request goes out', () async {
      final adapter = _FakeAdapter({
        'rogue.local': _FakeResponse(statusCode: 200, body: validPayload),
      });
      final dio = Dio()..httpClientAdapter = adapter;

      await expectLater(
        ManualPairingService(dio).resolve(host: '  ', code: '0123-ABCD'),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.invalidInput,
          ),
        ),
      );
      expect(adapter.callCounts, isEmpty);
    });
  });
}
