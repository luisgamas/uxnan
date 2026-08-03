import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:uxnan/core/utils/logger.dart';

/// Bytes of a remote Markdown resource plus the media type the preview must
/// decode them as.
class RemoteResource {
  /// Creates a fetched [RemoteResource].
  const RemoteResource({required this.bytes, required this.mimeType});

  /// Raw response body, untransformed (so an animated GIF keeps animating).
  final Uint8List bytes;

  /// Media type resolved from the response, never from the URL.
  final String mimeType;
}

/// Fetches the HTTPS resources a Markdown document embeds — README shields,
/// hosted screenshots — and reports the media type the *response* declares.
///
/// Badge services answer extensionless URLs
/// (`https://img.shields.io/github/stars/...`) with `image/svg+xml`, so
/// choosing a decoder from the URL hands SVG markup to the platform raster
/// decoder and every shield renders as a broken image. This service resolves
/// the type from `content-type` and the payload's own magic bytes instead, and
/// hands the bytes to the shared preview widget that already renders both
/// families.
///
/// Guarded like the other infrastructure services: only `https` is fetched,
/// the body is bounded, and any failure surfaces as a thrown
/// [RemoteResourceException] the caller renders as a broken-resource
/// placeholder.
class RemoteResourceService {
  /// Creates a [RemoteResourceService], optionally injecting the HTTP client
  /// (tests) and the maximum body size accepted.
  RemoteResourceService({Dio? client, int maxBytes = defaultMaxBytes})
      : _client = client ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 10),
                receiveTimeout: const Duration(seconds: 15),
                responseType: ResponseType.bytes,
                headers: const {'Accept': 'image/*,*/*;q=0.8'},
              ),
            ),
        _maxBytes = maxBytes;

  /// Largest response body accepted for an embedded resource (5 MiB), matching
  /// the bridge's own ordinary-file ceiling.
  static const int defaultMaxBytes = 5 * 1024 * 1024;

  /// Number of fetched resources kept in memory. A README rarely embeds more;
  /// the cap only stops a long browsing session from growing without bound.
  static const int maxCacheEntries = 64;

  final Dio _client;
  final int _maxBytes;
  final Map<String, Future<RemoteResource>> _cache = {};

  /// Fetches [url] once and replays the same result to later callers, so a
  /// document that repaints (scroll, theme change, preview toggle) never
  /// re-downloads a badge. Failures are not cached — pull-to-refresh retries.
  Future<RemoteResource> load(String url) {
    final cached = _cache[url];
    if (cached != null) return cached;
    final pending = _fetch(url);
    _cache[url] = pending;
    if (_cache.length > maxCacheEntries) _cache.remove(_cache.keys.first);
    // Forget a failure so the next paint can retry. The observer swallows the
    // error itself — the caller keeps the original future and reports it.
    unawaited(
      pending.then<void>(
        (_) {},
        onError: (Object _) {
          if (identical(_cache[url], pending)) _cache.remove(url);
        },
      ),
    );
    return pending;
  }

  Future<RemoteResource> _fetch(String url) async {
    try {
      final uri = Uri.tryParse(url.trim());
      if (uri == null || uri.scheme != 'https' || !uri.hasAuthority) {
        throw const RemoteResourceException('unsupported resource URL');
      }
      final response = await _client.getUri<List<int>>(
        uri,
        options: Options(responseType: ResponseType.bytes),
      );
      final body = response.data;
      if (body == null || body.isEmpty) {
        throw const RemoteResourceException('empty response');
      }
      if (body.length > _maxBytes) {
        throw const RemoteResourceException('resource exceeds the size limit');
      }
      final bytes = Uint8List.fromList(body);
      return RemoteResource(
        bytes: bytes,
        mimeType: resolveMediaType(
          contentType: response.headers.value(Headers.contentTypeHeader),
          bytes: bytes,
        ),
      );
    } on Object catch (error) {
      AppLogger.warn('Markdown resource fetch failed: $url', error);
      if (error is RemoteResourceException) rethrow;
      throw RemoteResourceException('$error');
    }
  }

  /// Releases the HTTP client and the cached bytes.
  void dispose() {
    _cache.clear();
    _client.close(force: true);
  }
}

/// Failure raised when an embedded Markdown resource cannot be fetched.
class RemoteResourceException implements Exception {
  /// Creates a [RemoteResourceException] describing [message].
  const RemoteResourceException(this.message);

  /// Human-readable reason, safe to show in a placeholder.
  final String message;

  @override
  String toString() => 'RemoteResourceException: $message';
}

/// Resolves the media type of a fetched resource from its [contentType] header
/// and, authoritatively, from the payload's own signature.
///
/// The signature wins over the header because badge and CDN endpoints routinely
/// answer with a generic `application/octet-stream` or omit the header, while
/// the bytes always identify themselves.
String resolveMediaType({
  required String? contentType,
  required Uint8List bytes,
}) {
  final sniffed = sniffMediaType(bytes);
  if (sniffed != null) return sniffed;
  final header = contentType?.split(';').first.trim().toLowerCase() ?? '';
  if (header.contains('svg')) return 'image/svg+xml';
  if (header.startsWith('image/')) return header;
  return 'application/octet-stream';
}

/// Identifies the raster or vector family of [bytes] by signature, or `null`
/// when the payload matches no format the preview can render.
String? sniffMediaType(Uint8List bytes) {
  if (bytes.length < 4) return null;
  if (_startsWith(bytes, const [0x89, 0x50, 0x4E, 0x47])) return 'image/png';
  if (_startsWith(bytes, const [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (_startsWith(bytes, const [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (_startsWith(bytes, const [0x42, 0x4D])) return 'image/bmp';
  if (_startsWith(bytes, const [0x52, 0x49, 0x46, 0x46]) &&
      bytes.length >= 12 &&
      _startsWith(bytes.sublist(8, 12), const [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }
  return _looksLikeSvg(bytes) ? 'image/svg+xml' : null;
}

/// Whether the head of [bytes] is XML markup containing an `<svg` element.
///
/// Only the head is inspected: a shield is a few hundred bytes, and a large
/// document that merely mentions `<svg` further down is not a vector image.
/// A UTF-8 byte-order mark and leading whitespace are skipped, since both are
/// common in files written by design tools.
bool _looksLikeSvg(Uint8List bytes) {
  var start = 0;
  if (bytes.length >= 3 &&
      bytes[0] == 0xEF &&
      bytes[1] == 0xBB &&
      bytes[2] == 0xBF) {
    start = 3;
  }
  final end = bytes.length < start + _svgSniffWindow
      ? bytes.length
      : start + _svgSniffWindow;
  final markup =
      String.fromCharCodes(bytes.sublist(start, end)).trimLeft().toLowerCase();
  if (!markup.startsWith('<')) return false;
  return markup.startsWith('<svg') ||
      ((markup.startsWith('<?xml') ||
              markup.startsWith('<!doctype') ||
              markup.startsWith('<!--')) &&
          markup.contains('<svg'));
}

const int _svgSniffWindow = 1024;

bool _startsWith(Uint8List bytes, List<int> signature) {
  if (bytes.length < signature.length) return false;
  for (var index = 0; index < signature.length; index++) {
    if (bytes[index] != signature[index]) return false;
  }
  return true;
}
