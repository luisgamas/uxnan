import 'dart:async';
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

/// Normalizes and de-duplicates candidate hosts for
/// [ManualPairingService.resolveAny], preserving first-seen order — so the
/// user's typed host (placed first by the caller) breaks ties over a
/// rediscovered duplicate. Entries that don't normalize to a usable
/// `host:port` (per [normalizeHostInput]) are dropped rather than raced.
List<String> dedupeResolveHosts(Iterable<String> hosts) {
  final seen = <String>{};
  final result = <String>[];
  for (final host in hosts) {
    final normalized = normalizeHostInput(host);
    if (normalized != null && seen.add(normalized)) result.add(normalized);
  }
  return result;
}

/// Ranks [ManualPairingErrorKind]s by how actionable they are for
/// [ManualPairingService.resolveAny] — lower is more useful to show the user.
/// A definitive answer FROM a reached bridge (wrong/expired code, rate
/// limited, a malformed/server reply) always outranks a plain "unreachable":
/// the latter just means *this one candidate* never answered, not that
/// pairing itself is broken, so it should only surface when nothing reached
/// any bridge at all.
int resolveErrorPriority(ManualPairingErrorKind kind) => switch (kind) {
      ManualPairingErrorKind.invalidOrExpiredCode => 0,
      ManualPairingErrorKind.rateLimited => 1,
      ManualPairingErrorKind.malformedPayload => 2,
      ManualPairingErrorKind.server => 3,
      ManualPairingErrorKind.network => 4,
      ManualPairingErrorKind.invalidInput => 5,
    };

/// Resolves a manual pairing code into a [PairingPayload] by calling the
/// **bridge** directly (`GET /pair/resolve?code=`), bypassing the QR scan. The
/// returned payload is fed into the normal pairing handshake
/// (`SessionCoordinator.processPairingPayload`).
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

  // FOR-DEV: `resolveAny` only reaches hosts directly dialable from the phone
  // right now (the typed host + LAN mDNS candidates) — a phone with no
  // LAN/Tailscale path to the PC at all (e.g. cellular data only, PC not yet
  // joined to Tailscale) still can't resolve a code. Fetching the payload
  // through the relay instead of this direct GET would let pairing work with
  // no direct reachability at all, but needs a new relay+bridge+shared
  // contract (the relay has no route to reach an unpaired bridge on the
  // phone's behalf today). See FOR-DEV.md.
  /// Resolves [code] by racing it concurrently against every candidate in
  /// [hosts] (deduplicated via [dedupeResolveHosts]) — the first `HTTP 2xx`
  /// wins. Built so a stale or wrong typed host doesn't dead-end pairing: the
  /// caller mixes in any bridges discovered via mDNS
  /// (`BridgeDiscoveryService`), and whichever one actually answers wins,
  /// exactly like [DirectTransportSelector] already races the paired device's
  /// advertised hosts for the live WS connection.
  ///
  /// On failure, throws the single most actionable [ManualPairingException]
  /// across every attempt (see [resolveErrorPriority]) — so, for example, a
  /// wrong/expired code reported by one reachable bridge is shown instead of
  /// a generic "unreachable" from a different candidate that never answered.
  Future<PairingPayload> resolveAny({
    required Iterable<String> hosts,
    required String code,
  }) async {
    final candidates = dedupeResolveHosts(hosts);
    if (candidates.isEmpty) {
      throw const ManualPairingException(ManualPairingErrorKind.invalidInput);
    }

    final completer = Completer<PairingPayload>();
    var pending = candidates.length;
    ManualPairingException? bestError;

    void fail(ManualPairingException error) {
      if (bestError == null ||
          resolveErrorPriority(error.kind) <
              resolveErrorPriority(bestError!.kind)) {
        bestError = error;
      }
      pending--;
      if (pending == 0 && !completer.isCompleted) {
        completer.completeError(
          bestError ??
              const ManualPairingException(ManualPairingErrorKind.network),
        );
      }
    }

    for (final host in candidates) {
      unawaited(
        resolve(host: host, code: code).then((payload) {
          if (!completer.isCompleted) completer.complete(payload);
        }).catchError((Object error) {
          fail(
            error is ManualPairingException
                ? error
                : const ManualPairingException(ManualPairingErrorKind.network),
          );
        }),
      );
    }

    return completer.future;
  }
}
