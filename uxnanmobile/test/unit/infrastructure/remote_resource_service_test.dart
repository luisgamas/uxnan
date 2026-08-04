import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/media/remote_resource_service.dart';

/// Minimal adapter so the service is exercised without a socket.
class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.respond);

  final ResponseBody Function(RequestOptions options) respond;
  final List<String> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options.uri.toString());
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

RemoteResourceService _serviceWith(_StubAdapter adapter, {int? maxBytes}) {
  final dio = Dio(BaseOptions(responseType: ResponseType.bytes))
    ..httpClientAdapter = adapter;
  return maxBytes == null
      ? RemoteResourceService(client: dio)
      : RemoteResourceService(client: dio, maxBytes: maxBytes);
}

const _shield =
    '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="20"></svg>';

/// 1x1 transparent PNG.
final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk'
  '+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

void main() {
  group('sniffMediaType', () {
    test('identifies raster signatures', () {
      expect(sniffMediaType(_png), 'image/png');
      expect(
        sniffMediaType(Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0])),
        'image/jpeg',
      );
      expect(
        sniffMediaType(Uint8List.fromList(utf8.encode('GIF89a...'))),
        'image/gif',
      );
      expect(
        sniffMediaType(
          Uint8List.fromList([
            ...utf8.encode('RIFF'),
            0, 0, 0, 0, //
            ...utf8.encode('WEBP'),
          ]),
        ),
        'image/webp',
      );
    });

    test('identifies SVG markup, including XML prologues and leading space',
        () {
      expect(
        sniffMediaType(Uint8List.fromList(utf8.encode(_shield))),
        'image/svg+xml',
      );
      expect(
        sniffMediaType(
          Uint8List.fromList(utf8.encode('\n  <?xml version="1.0"?>$_shield')),
        ),
        'image/svg+xml',
      );
      expect(
        sniffMediaType(
          Uint8List.fromList([0xEF, 0xBB, 0xBF, ...utf8.encode(_shield)]),
        ),
        'image/svg+xml',
      );
    });

    test('returns null for markup that is not an image', () {
      expect(
        sniffMediaType(Uint8List.fromList(utf8.encode('<html><body></body>'))),
        isNull,
      );
      expect(sniffMediaType(Uint8List.fromList(utf8.encode('no'))), isNull);
    });
  });

  group('resolveMediaType', () {
    test('prefers the payload signature over a generic header', () {
      expect(
        resolveMediaType(
          contentType: 'application/octet-stream',
          bytes: Uint8List.fromList(utf8.encode(_shield)),
        ),
        'image/svg+xml',
      );
    });

    test('falls back to the header when the payload is unrecognized', () {
      expect(
        resolveMediaType(
          contentType: 'image/svg+xml; charset=utf-8',
          bytes: Uint8List.fromList(utf8.encode('?')),
        ),
        'image/svg+xml',
      );
      expect(
        resolveMediaType(
          contentType: 'image/avif',
          bytes: Uint8List.fromList(utf8.encode('????')),
        ),
        'image/avif',
      );
      expect(
        resolveMediaType(
          contentType: null,
          bytes: Uint8List.fromList(utf8.encode('????')),
        ),
        'application/octet-stream',
      );
    });
  });

  group('RemoteResourceService', () {
    test('types an extensionless shield from its payload, not its URL',
        () async {
      final adapter = _StubAdapter(
        (_) => ResponseBody.fromBytes(
          utf8.encode(_shield),
          200,
          headers: {
            Headers.contentTypeHeader: ['image/svg+xml;charset=utf-8'],
          },
        ),
      );
      final service = _serviceWith(adapter);
      addTearDown(service.dispose);

      final resource = await service.load(
        'https://img.shields.io/github/stars/luisgamas/uxnan?style=flat-square',
      );

      expect(resource.mimeType, 'image/svg+xml');
      expect(utf8.decode(resource.bytes), _shield);
    });

    test('serves a repeated URL from cache without refetching', () async {
      final adapter = _StubAdapter(
        (_) => ResponseBody.fromBytes(_png, 200, headers: {}),
      );
      final service = _serviceWith(adapter);
      addTearDown(service.dispose);

      final first = await service.load('https://example.com/a.png');
      final second = await service.load('https://example.com/a.png');

      expect(first.mimeType, 'image/png');
      expect(second.bytes, first.bytes);
      expect(adapter.requests, hasLength(1));
    });

    test('does not cache a failure, so the next paint retries', () async {
      var attempts = 0;
      final adapter = _StubAdapter((_) {
        attempts++;
        if (attempts == 1) throw const SocketFailure();
        return ResponseBody.fromBytes(_png, 200, headers: {});
      });
      final service = _serviceWith(adapter);
      addTearDown(service.dispose);

      await expectLater(
        service.load('https://example.com/a.png'),
        throwsA(isA<RemoteResourceException>()),
      );
      final retried = await service.load('https://example.com/a.png');

      expect(retried.mimeType, 'image/png');
      expect(attempts, 2);
    });

    test('rejects a non-HTTPS URL without touching the network', () async {
      final adapter = _StubAdapter(
        (_) => ResponseBody.fromBytes(_png, 200, headers: {}),
      );
      final service = _serviceWith(adapter);
      addTearDown(service.dispose);

      await expectLater(
        service.load('http://example.com/a.png'),
        throwsA(isA<RemoteResourceException>()),
      );
      expect(adapter.requests, isEmpty);
    });

    test('rejects a body over the size limit', () async {
      final adapter = _StubAdapter(
        (_) => ResponseBody.fromBytes(
          Uint8List(64),
          200,
          headers: {},
        ),
      );
      final service = _serviceWith(adapter, maxBytes: 16);
      addTearDown(service.dispose);

      await expectLater(
        service.load('https://example.com/big.png'),
        throwsA(isA<RemoteResourceException>()),
      );
    });
  });
}

/// Stand-in for a transport failure raised by the adapter.
class SocketFailure implements Exception {
  const SocketFailure();
}
