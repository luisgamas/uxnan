import 'dart:async';

import 'package:uxnan/core/errors/transport_exception.dart';
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
    // 1. Direct LAN/Tailscale hosts (no relay headers). Dialed CONCURRENTLY so a
    //    dead or slow host — an unreachable virtual NIC, or a Tailscale tunnel
    //    still waking after the OS suspended the app — can't stall a reachable
    //    host queued behind it. The first host to connect within the per-host
    //    timeout wins; the rest are dropped. (Serial dialing would stack one
    //    full timeout per dead host ahead of a live one.)
    if (device.hosts.isNotEmpty) {
      final winner = await _dialDirectHosts(device.hosts);
      if (winner != null) return winner;
    }

    // 2. Relay fallback (WAN), routed with the session headers. Bounded by
    //    [_relayTimeout] so an unreachable relay never hangs the caller.
    if (device.relayUrl.isEmpty) {
      throw const TransportException(
        TransportErrorKind.connection,
        'No reachable transport: every direct host failed and no relay is set',
      );
    }
    final transport = _createTransport();
    try {
      await transport.connect(
        device.relayUrl,
        headers: {
          'x-role': 'iphone',
          'x-session-id': device.sessionId,
        },
      ).timeout(_relayTimeout);
      return transport;
    } on Object catch (error) {
      await transport.disconnect().catchError((_) {});
      throw TransportException(
        TransportErrorKind.connection,
        'Relay unreachable after ${_relayTimeout.inSeconds}s: $error',
      );
    }
  }

  /// Dials every [hosts] entry concurrently and resolves with the first
  /// transport that connects within [_directTimeout], or `null` if they all
  /// fail/time out. Every non-winning transport (failed, timed out, or a slower
  /// success) is disconnected, so exactly one live transport is ever returned.
  Future<WebSocketTransport?> _dialDirectHosts(List<String> hosts) {
    final decided = Completer<WebSocketTransport?>();
    final transports = <WebSocketTransport>[];
    var pending = hosts.length;

    for (final host in hosts) {
      final transport = _createTransport();
      transports.add(transport);
      transport.connect(_directUrl(host)).timeout(_directTimeout).then((_) {
        if (decided.isCompleted) {
          // Another host already won this race — drop this late success.
          unawaited(transport.disconnect().catchError((_) {}));
          return;
        }
        decided.complete(transport);
      }).catchError((Object _) {
        unawaited(transport.disconnect().catchError((_) {}));
      }).whenComplete(() {
        pending--;
        if (pending == 0 && !decided.isCompleted) decided.complete(null);
      });
    }

    // Once a winner is chosen, disconnect every other transport (the losers and
    // any still-in-flight attempts) so only the winner stays open.
    return decided.future.then((winner) {
      if (winner != null) {
        for (final transport in transports) {
          if (!identical(transport, winner)) {
            unawaited(transport.disconnect().catchError((_) {}));
          }
        }
      }
      return winner;
    });
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
