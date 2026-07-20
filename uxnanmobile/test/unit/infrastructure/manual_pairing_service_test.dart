import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/pairing/manual_pairing_service.dart';

/// A canned HTTP response for [_FakeAdapter].
class _FakeResponse {
  const _FakeResponse({
    required this.statusCode,
    this.body,
    this.delay = Duration.zero,
  });

  final int statusCode;
  final Object? body;
  final Duration delay;
}

/// A minimal [HttpClientAdapter] that answers per-host from [responses] and
/// counts how many requests each host received, so `resolveAny`'s dedup and
/// racing can be verified without a real network. A host absent from
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
    if (response.delay > Duration.zero) {
      await Future<void>.delayed(response.delay);
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
/// and [ManualPairingService.resolveAny] tests below.
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

  group('dedupeResolveHosts', () {
    test('normalizes, dedupes, and preserves first-seen order', () {
      expect(
        dedupeResolveHosts(
          ['192.168.1.5', '192.168.1.5:19850', '10.0.0.2:8080'],
        ),
        ['192.168.1.5:19850', '10.0.0.2:8080'],
      );
    });

    test('drops entries that do not normalize to a usable host:port', () {
      expect(dedupeResolveHosts(['', '   ', 'host:notaport']), isEmpty);
    });
  });

  group('resolveErrorPriority', () {
    test('a definitive answer from a reached bridge outranks "unreachable"',
        () {
      expect(
        resolveErrorPriority(ManualPairingErrorKind.invalidOrExpiredCode),
        lessThan(resolveErrorPriority(ManualPairingErrorKind.network)),
      );
      expect(
        resolveErrorPriority(ManualPairingErrorKind.rateLimited),
        lessThan(resolveErrorPriority(ManualPairingErrorKind.network)),
      );
      expect(
        resolveErrorPriority(ManualPairingErrorKind.malformedPayload),
        lessThan(resolveErrorPriority(ManualPairingErrorKind.network)),
      );
      expect(
        resolveErrorPriority(ManualPairingErrorKind.server),
        lessThan(resolveErrorPriority(ManualPairingErrorKind.network)),
      );
    });

    test('"unreachable" still outranks a caller input error', () {
      expect(
        resolveErrorPriority(ManualPairingErrorKind.network),
        lessThan(resolveErrorPriority(ManualPairingErrorKind.invalidInput)),
      );
    });
  });

  group('ManualPairingService.resolveAny', () {
    test('an empty candidate list throws invalidInput without any request', () {
      final service = ManualPairingService(Dio());
      expect(
        () => service.resolveAny(hosts: const [], code: 'ABC'),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.invalidInput,
          ),
        ),
      );
    });

    test('the first host to answer 2xx wins, even over a slower one', () async {
      final adapter = _FakeAdapter({
        'slow.local': _FakeResponse(
          statusCode: 200,
          body: {...validPayload, 'displayName': 'Slow PC'},
          delay: const Duration(milliseconds: 150),
        ),
        'fast.local': _FakeResponse(
          statusCode: 200,
          body: {...validPayload, 'displayName': 'Fast PC'},
        ),
      });
      final service = ManualPairingService(Dio()..httpClientAdapter = adapter);
      final payload = await service.resolveAny(
        hosts: ['slow.local:19850', 'fast.local:19850'],
        code: 'ABC',
      );
      expect(payload.displayName, 'Fast PC');
    });

    test('duplicate candidates that normalize the same are dialed once',
        () async {
      final adapter = _FakeAdapter({
        'pc.local': _FakeResponse(statusCode: 200, body: validPayload),
      });
      final service = ManualPairingService(Dio()..httpClientAdapter = adapter);
      await service.resolveAny(
        // The default-port form and the explicit-port form normalize to the
        // same `host:port`, so only one dial should ever go out.
        hosts: ['pc.local', 'pc.local:19850', 'pc.local:19850'],
        code: 'ABC',
      );
      expect(adapter.callCounts['pc.local'], 1);
    });

    test(
        'when every candidate fails, a definitive answer wins over '
        '"unreachable"', () async {
      final adapter = _FakeAdapter({
        'wrong-code.local': const _FakeResponse(statusCode: 403),
        // 'unreachable.local' is deliberately absent from the response map,
        // so the fake adapter throws a connection error for it.
      });
      final service = ManualPairingService(Dio()..httpClientAdapter = adapter);
      await expectLater(
        service.resolveAny(
          hosts: ['wrong-code.local:19850', 'unreachable.local:19850'],
          code: 'ABC',
        ),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.invalidOrExpiredCode,
          ),
        ),
      );
    });

    test('when nothing is reachable at all, the error kind is network',
        () async {
      final adapter = _FakeAdapter(const {});
      final service = ManualPairingService(Dio()..httpClientAdapter = adapter);
      await expectLater(
        service.resolveAny(
          hosts: ['a.local:19850', 'b.local:19850'],
          code: 'ABC',
        ),
        throwsA(
          isA<ManualPairingException>().having(
            (e) => e.kind,
            'kind',
            ManualPairingErrorKind.network,
          ),
        ),
      );
    });
  });
}
