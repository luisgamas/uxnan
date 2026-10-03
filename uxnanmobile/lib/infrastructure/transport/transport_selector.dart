import 'dart:async';

import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/infrastructure/transport/relay_client.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// Chooses and opens a [WebSocketTransport] for a [TrustedDevice].
///
/// Spec 02a §5.9.3 prefers a direct connection and falls back to the relay.
/// The bridge advertises its direct addresses in the pairing QR
/// ([TrustedDevice.hosts]) and its own relay in the QR and its shared settings
/// ([TrustedDevice.relay]); [DirectTransportSelector] tries the hosts first
/// and falls back to the relay. The E2EE semantics are identical on either
/// channel.
// ignore: one_member_abstracts — a DI seam (tests supply in-memory channels).
abstract class TransportSelector {
  /// Returns a connected transport for [device]. [relayTicket] is the pairing
  /// QR's one-time relay ticket, given only for the first connection of a
  /// phone pairing through the relay.
  Future<WebSocketTransport> select(
    TrustedDevice device, {
    String? relayTicket,
  });
}

/// Tries the device's direct LAN/Tailscale [TrustedDevice.hosts] first (each
/// `host:port` as a plain `ws://` endpoint), then — only when the bridge has
/// one and it is on — the user's own relay through [RelayClient] (spec 02a
/// §5.9.3, §5.10). LAN-direct is the primary plug-and-play path, Tailscale a
/// no-hosting remote option, and the relay the way in from any other network.
class DirectTransportSelector implements TransportSelector {
  /// Creates a [DirectTransportSelector]. `createTransport` builds a fresh
  /// transport per direct attempt (injected so tests can supply an in-memory
  /// one). [relayClient] opens the relay fallback; without one, only direct
  /// hosts are tried. [directTimeout] bounds each direct host attempt before
  /// moving on.
  DirectTransportSelector(
    this._createTransport, {
    RelayClient? relayClient,
    Duration directTimeout = const Duration(seconds: 2),
  })  : _relayClient = relayClient,
        _directTimeout = directTimeout;

  final WebSocketTransport Function() _createTransport;
  final RelayClient? _relayClient;
  final Duration _directTimeout;

  @override
  Future<WebSocketTransport> select(
    TrustedDevice device, {
    String? relayTicket,
  }) async {
    // 1. Direct LAN/Tailscale hosts. Dialed CONCURRENTLY so a dead or slow
    //    host — an unreachable virtual NIC, or a Tailscale tunnel still waking
    //    after the OS suspended the app — can't stall a reachable host queued
    //    behind it. The first host to connect within the per-host timeout
    //    wins; the rest are dropped. (Serial dialing would stack one full
    //    timeout per dead host ahead of a live one.)
    if (device.hosts.isNotEmpty) {
      final winner = await _dialDirectHosts(device.hosts);
      if (winner != null) return winner;
    }

    // 2. The bridge's own relay, when it has one and serves phones through
    //    it. [RelayClient] bounds every step, and a refusal comes back as a
    //    RelayException naming why (PC offline, phone no longer paired, …).
    final relay = device.relay;
    final relayClient = _relayClient;
    if (relay == null || !relay.enabled || relayClient == null) {
      throw const TransportException(
        TransportErrorKind.connection,
        'No reachable transport: every direct host failed and no relay is on',
      );
    }
    return relayClient.connect(relay, ticket: relayTicket);
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
