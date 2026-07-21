import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';

/// Default bridge LAN port (`DEFAULT_LAN_PORT` in `@uxnan/shared`), used when the
/// user types a host without an explicit `:port`.
const int kDefaultBridgePort = 19850;

/// Why a manual-code pairing resolution failed.
enum ManualPairingErrorKind {
  /// The host or code field was empty / unparseable before any request.
  invalidInput,

  /// The bridge could not be reached (timeout, refused, wrong host).
  network,

  /// The code was wrong or has expired (`403`).
  invalidOrExpiredCode,

  /// Too many attempts from this device (`429`).
  rateLimited,

  /// The bridge answered, but not with a usable payload (`4xx/5xx` or garbage).
  server,

  /// A `200` body that did not decode into a [PairingPayload].
  malformedPayload,
}

/// A failure resolving a manual pairing code into a [PairingPayload].
class ManualPairingException implements Exception {
  /// Creates a [ManualPairingException].
  const ManualPairingException(this.kind, [this.message]);

  /// The classified failure reason (drives the user-facing copy).
  final ManualPairingErrorKind kind;

  /// Optional technical detail (logged, not shown verbatim).
  final String? message;

  @override
  String toString() {
    final detail = message == null ? '' : ': $message';
    return 'ManualPairingException(${kind.name}$detail)';
  }
}

/// Normalizes a typed host into `host:port`, applying [defaultPort] when no
/// explicit port is present. Strips a leading scheme and any path. Returns
/// `null` when the input can't yield a usable host (so the caller surfaces an
/// `invalidInput` error instead of building a bad URL).
String? normalizeHostInput(
  String input, {
  int defaultPort = kDefaultBridgePort,
}) {
  var value = input.trim();
  if (value.isEmpty) return null;
  // Drop a scheme (http://, ws://, …) and anything from the first path/query char.
  value = value.replaceFirst(RegExp('^[a-zA-Z][a-zA-Z0-9+.-]*://'), '');
  value = value.split('/').first.split('?').first.trim();
  if (value.isEmpty) return null;

  final colon = value.lastIndexOf(':');
  if (colon > 0) {
    final host = value.substring(0, colon);
    final port = int.tryParse(value.substring(colon + 1));
    if (host.isEmpty) return null;
    if (port == null || port <= 0 || port > 65535) return null;
    return '$host:$port';
  }
  // Bare host → apply the default bridge port.
  return '$value:$defaultPort';
}

/// Builds the `GET http://<host:port>/pair/resolve?code=<code>` URI. Expects a
/// `host:port` from [normalizeHostInput]; encodes the `code` query param.
Uri buildPairResolveUri(String hostPort, String code) {
  final colon = hostPort.lastIndexOf(':');
  final host = hostPort.substring(0, colon);
  final port = int.parse(hostPort.substring(colon + 1));
  return Uri(
    scheme: 'http',
    host: host,
    port: port,
    path: '/pair/resolve',
    queryParameters: {'code': code},
  );
}

/// Maps the `/pair/resolve` HTTP status + body into a [PairingPayload] or throws
/// a classified [ManualPairingException]. The bridge returns the payload object
/// directly on `200`, `403` for a bad/expired code, `429` when rate-limited.
PairingPayload parsePairResolveResponse(int statusCode, Object? data) {
  switch (statusCode) {
    case 200:
      try {
        final decoded =
            data is String && data.isNotEmpty ? jsonDecode(data) : data;
        if (decoded is! Map) {
          throw const ManualPairingException(
            ManualPairingErrorKind.malformedPayload,
          );
        }
        return PairingPayload.fromJson(Map<String, dynamic>.from(decoded));
      } on ManualPairingException {
        rethrow;
      } on FormatException catch (e) {
        throw ManualPairingException(
          ManualPairingErrorKind.malformedPayload,
          e.message,
        );
      }
    case 403:
      throw const ManualPairingException(
        ManualPairingErrorKind.invalidOrExpiredCode,
      );
    case 429:
      throw const ManualPairingException(ManualPairingErrorKind.rateLimited);
    default:
      throw ManualPairingException(
        ManualPairingErrorKind.server,
        'HTTP $statusCode',
      );
  }
}

/// Resolves a manual pairing code into a [PairingPayload] by calling the
/// **bridge** directly (`GET /pair/resolve?code=`), bypassing the QR scan. The
/// returned payload is fed into the normal pairing handshake
/// (`SessionCoordinator.processPairingPayload`).
///
/// The code is a shared secret read off the PC screen, and a successful
/// resolve both hands out the pairing payload and arms the bridge's
/// `qr_bootstrap` window. So it is sent to exactly ONE host — the one the user
/// named — and never fanned out across candidates: mDNS records are
/// unauthenticated and spoofable by any device on the network, so racing
/// discovered hosts would disclose the code to them and let the first
/// responder impersonate the PC.
class ManualPairingService {
  /// Creates a [ManualPairingService] over [_dio].
  ManualPairingService(this._dio);

  final Dio _dio;

  /// Resolves [code] against the bridge at [host] (`host` or `host:port`).
  Future<PairingPayload> resolve({
    required String host,
    required String code,
  }) async {
    final hostPort = normalizeHostInput(host);
    final trimmedCode = code.trim();
    if (hostPort == null || trimmedCode.isEmpty) {
      throw const ManualPairingException(ManualPairingErrorKind.invalidInput);
    }
    final uri = buildPairResolveUri(hostPort, trimmedCode);
    try {
      final res = await _dio.getUri<Object?>(
        uri,
        options: Options(
          responseType: ResponseType.json,
          validateStatus: (_) => true,
        ),
      );
      return parsePairResolveResponse(res.statusCode ?? 0, res.data);
    } on DioException catch (e) {
      throw ManualPairingException(ManualPairingErrorKind.network, e.message);
    }
  }
}
