import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// Chooses and opens a [WebSocketTransport] for a [TrustedDevice].
///
/// Spec 02a §5.9.3 prefers a direct LAN connection and falls back to the relay.
/// The bridge advertises its direct addresses in the pairing QR
/// ([TrustedDevice.hosts]); [DirectTransportSelector] tries those first and
/// falls back to the relay. The E2EE semantics are identical on either channel.
// ignore: one_member_abstracts — a DI seam with multiple impls (direct/relay).
abstract class TransportSelector {
  /// Returns a connected transport for [device].
  Future<WebSocketTransport> select(TrustedDevice device);
}

/// Tries the device's direct LAN/Tailscale [TrustedDevice.hosts] first (each
/// `host:port` as a plain `ws://` endpoint — the bridge's LAN server needs no
/// relay routing headers), then falls back to the relay (spec 02a §5.9.3). This
/// makes LAN-direct the primary plug-and-play path and Tailscale a no-hosting
/// remote option, with the hosted relay as an optional fallback.
class DirectTransportSelector implements TransportSelector {
  /// Creates a [DirectTransportSelector]. `createTransport` builds a fresh
  /// transport per attempt (injected so tests can supply an in-memory one).
  /// [directTimeout] bounds each direct host attempt before moving on.
  /// [relayTimeout] bounds the fallback relay connection (prevents hanging when
  /// the relay URL is unreachable).
  DirectTransportSelector(
    this._createTransport, {
    Duration directTimeout = const Duration(seconds: 2),
    Duration relayTimeout = const Duration(seconds: 10),
  })  : _directTimeout = directTimeout,
        _relayTimeout = relayTimeout;

  final WebSocketTransport Function() _createTransport;
  final Duration _directTimeout;
  final Duration _relayTimeout;

  @override
  Future<WebSocketTransport> select(TrustedDevice device) async {
    // 1. Direct LAN/Tailscale hosts (no relay headers; short per-host timeout
    //    so an unreachable address — e.g. a virtual NIC — doesn't stall us).
    for (final host in device.hosts) {
      final transport = _createTransport();
      // FOR-DEV: Bug A diagnostic — time each transport attempt so we can see
      // where post-resume relink latency goes (see uxnanmobile/FOR-DEV.md).
      final sw = Stopwatch()..start();
      try {
        await transport.connect(_directUrl(host)).timeout(_directTimeout);
        AppLogger.info(
          '[reconn] direct "$host" connected in '
          '${sw.elapsedMilliseconds}ms',
        );
        return transport;
      } on Object catch (error) {
        AppLogger.info(
          '[reconn] direct "$host" unreachable in '
          '${sw.elapsedMilliseconds}ms: $error',
        );
        await transport.disconnect().catchError((_) {});
      }
    }
    AppLogger.info('[reconn] all direct hosts failed → relay fallback');

    // 2. Relay fallback (WAN), routed with the session headers. Bounded by
    //    [_relayTimeout] so an unreachable relay never hangs the caller.
    if (device.relayUrl.isEmpty) {
      throw const TransportException(
        TransportErrorKind.connection,
        'No reachable transport: every direct host failed and no relay is set',
      );
    }
    final transport = _createTransport();
    final sw = Stopwatch()..start();
    try {
      await transport.connect(
        device.relayUrl,
        headers: {
          'x-role': 'iphone',
          'x-session-id': device.sessionId,
        },
      ).timeout(_relayTimeout);
      AppLogger.info('[reconn] relay connected in ${sw.elapsedMilliseconds}ms');
      return transport;
    } on Object catch (error) {
      AppLogger.info(
        '[reconn] relay fallback failed in '
        '${sw.elapsedMilliseconds}ms: $error',
      );
      await transport.disconnect().catchError((_) {});
      throw TransportException(
        TransportErrorKind.connection,
        'Relay unreachable after ${_relayTimeout.inSeconds}s: $error',
      );
    }
  }

  /// Builds a `ws://` URL from a bare `host:port`, leaving an explicit
  /// `ws://`/`wss://` scheme untouched.
  static String _directUrl(String host) {
    if (host.startsWith('ws://') || host.startsWith('wss://')) return host;
    return 'ws://$host';
  }
}

/// Connects to the bridge through the relay using the device's `relayUrl`.
/// Kept for relay-only setups and tests; [DirectTransportSelector] is the
/// default selector (direct-first with a relay fallback).
class RelayTransportSelector implements TransportSelector {
  /// Creates a [RelayTransportSelector]. `createTransport` builds a fresh
  /// transport per connection (injected so tests can supply an in-memory one).
  RelayTransportSelector(this._createTransport);

  final WebSocketTransport Function() _createTransport;

  @override
  Future<WebSocketTransport> select(TrustedDevice device) async {
    final transport = _createTransport();
    await transport.connect(
      device.relayUrl,
      headers: {
        'x-role': 'iphone',
        'x-session-id': device.sessionId,
      },
    );
    return transport;
  }
}
