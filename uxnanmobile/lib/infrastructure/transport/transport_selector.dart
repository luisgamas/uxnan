import 'dart:async';
import 'dart:collection';

import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/entities/discovered_bridge.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/relay_reason.dart';
import 'package:uxnan/infrastructure/discovery/bridge_discovery_service.dart';
import 'package:uxnan/infrastructure/transport/relay_client.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// Whether the phone is on a local network right now (Wi-Fi or Ethernet) —
/// the only kind on which a PC can be looked for by mDNS.
typedef LocalNetworkCheck = Future<bool> Function();

/// Proves that [transport] reaches the PC the phone trusts — the E2EE
/// handshake — and returns what it opened ([S], the secure session). Throws
/// when it does not; the selector then closes that transport and goes on.
typedef TransportSecurer<S> = Future<S> Function(WebSocketTransport transport);

/// A transport that reached the PC and passed the handshake, and why it is
/// the relay when that is worth knowing.
class TransportSelection<S> {
  /// Creates a [TransportSelection].
  const TransportSelection(this.transport, this.secured, {this.relayReason});

  /// The connected transport — a direct host or the relay.
  final WebSocketTransport transport;

  /// What the [TransportSecurer] opened over [transport].
  final S secured;

  /// Set only when [transport] is the relay although a direct path was there
  /// ([RelayReason]).
  final RelayReason? relayReason;
}

/// What one try of the PC's direct addresses found
/// ([TransportSelector.selectDirect]).
class DirectSelection<S> {
  /// Creates a [DirectSelection].
  const DirectSelection({this.transport, this.secured, this.relayReason});

  /// The direct transport that answered and passed the handshake, or `null`.
  final WebSocketTransport? transport;

  /// What the [TransportSecurer] opened over [transport], when there is one.
  final S? secured;

  /// When nothing passed: why the session is (or stays) on the relay, when a
  /// direct path was there ([RelayReason]).
  final RelayReason? relayReason;
}

/// Chooses, opens and secures a transport for a [TrustedDevice].
///
/// Spec 02a §5.9.3 prefers a direct connection and falls back to the relay.
/// The PC's direct addresses ([TrustedDevice.hosts]: the pairing QR's, kept
/// current from `BridgeSettings.hosts`) and its relay ([TrustedDevice.relay])
/// come from the PC record; [DirectTransportSelector] tries the addresses —
/// and, on a local network, whatever the PC announces there by mDNS — before
/// the relay. A direct address only counts once the E2EE handshake over it
/// succeeded (the caller's [TransportSecurer]): a device that merely accepts
/// the socket is skipped, never the end of the attempt. The E2EE semantics
/// are identical on either channel.
abstract class TransportSelector {
  /// Returns a connected, secured transport for [device]: the first direct
  /// address whose handshake ([secure]) succeeds, else the relay secured the
  /// same way. [relayTicket] is the pairing QR's one-time relay ticket, given
  /// only for the first connection of a phone pairing through the relay.
  ///
  /// Throws when no direct address passes and the PC has no relay switched
  /// on: the last direct handshake error when an address answered, else a
  /// [TransportException] of kind [TransportErrorKind.noRoute]. A relay that
  /// refuses throws its `RelayException`; a failed handshake over the relay
  /// throws that error.
  Future<TransportSelection<S>> select<S>(
    TrustedDevice device, {
    required TransportSecurer<S> secure,
    String? relayTicket,
  });

  /// Tries only [device]'s direct addresses, once, and returns the first
  /// whose handshake ([secure]) succeeds — or none. Never touches the relay:
  /// the session uses it to leave the relay for a direct path while the relay
  /// session keeps working.
  Future<DirectSelection<S>> selectDirect<S>(
    TrustedDevice device, {
    required TransportSecurer<S> secure,
  });
}

/// Tries the device's direct LAN/Tailscale [TrustedDevice.hosts] (each
/// `host:port` as a plain `ws://` endpoint), then — only when the bridge has
/// one and it is on — the user's own relay through [RelayClient] (spec 02a
/// §5.9.3, §5.10). LAN-direct is the primary plug-and-play path, Tailscale a
/// no-hosting remote option, and the relay the way in from any other network.
///
/// **On a local network the PC is also looked for by mDNS** ([LanBridgeFinder],
/// `_uxnan._tcp`, matched on the TXT `id` = [TrustedDevice.macDeviceId]) for at
/// most [mdnsWindow], started together with the stored addresses: an address
/// it reveals joins the same attempt. That finds a PC whose address changed
/// while the phone could not hear about it. Nothing found is stored — once
/// connected, the bridge says where it listens (`BridgeSettings.hosts`) and
/// the replica stores that. No browse runs on cellular, nor for a PC with no
/// direct address at all (its LAN server is off, so it announces nothing).
///
/// **Nothing on the network can keep the phone off its relay.** Every direct
/// address is only a candidate until its handshake succeeds, within
/// [directHandshakeTimeout]; one that fails (another device on that address,
/// a spoofed announcement, a protocol error, silence) is closed and skipped
/// for the rest of the attempt, and the attempt goes on to the next
/// candidate and then the relay. A stored address is always tried before an
/// announced one: an mDNS announcement is unsigned, so it only gets a turn
/// once no stored address is still in play.
class DirectTransportSelector implements TransportSelector {
  /// Creates a [DirectTransportSelector]. `createTransport` builds a fresh
  /// transport per direct attempt (injected so tests can supply an in-memory
  /// one). [relayClient] opens the relay fallback; without one, only direct
  /// hosts are tried. [directTimeout] bounds each direct socket;
  /// [directHandshakeTimeout] the handshake over it. [lanFinder] and
  /// [onLocalNetwork] enable the mDNS look-up; without both, only the stored
  /// addresses are tried.
  DirectTransportSelector(
    this._createTransport, {
    RelayClient? relayClient,
    LanBridgeFinder? lanFinder,
    LocalNetworkCheck? onLocalNetwork,
    Duration directTimeout = const Duration(seconds: 2),
    Duration directHandshakeTimeout = const Duration(seconds: 8),
    Duration mdnsWindow = const Duration(milliseconds: 2500),
  })  : _relayClient = relayClient,
        _lanFinder = lanFinder,
        _onLocalNetwork = onLocalNetwork,
        _directTimeout = directTimeout,
        _directHandshakeTimeout = directHandshakeTimeout,
        _mdnsWindow = mdnsWindow;

  final WebSocketTransport Function() _createTransport;
  final RelayClient? _relayClient;
  final LanBridgeFinder? _lanFinder;
  final LocalNetworkCheck? _onLocalNetwork;
  final Duration _directTimeout;
  final Duration _directHandshakeTimeout;
  final Duration _mdnsWindow;

  @override
  Future<TransportSelection<S>> select<S>(
    TrustedDevice device, {
    required TransportSecurer<S> secure,
    String? relayTicket,
  }) async {
    // 1. Direct LAN/Tailscale addresses, and what mDNS reveals — each only
    //    once its handshake succeeded.
    final direct = await _direct(device, secure);
    final winner = direct.transport;
    if (winner != null) {
      return TransportSelection(winner, direct.secured as S);
    }

    // 2. The bridge's own relay, when it has one and serves phones through
    //    it. [RelayClient] bounds every step, and a refusal comes back as a
    //    RelayException naming why (PC offline, phone no longer paired, …).
    final relay = device.relay;
    final relayClient = _relayClient;
    if (relay == null || !relay.enabled || relayClient == null) {
      final handshakeError = direct.handshakeError;
      if (handshakeError != null) {
        Error.throwWithStackTrace(
          handshakeError.$1,
          handshakeError.$2,
        );
      }
      throw const TransportException(
        TransportErrorKind.noRoute,
        'No reachable transport: every direct host failed and no relay is on',
      );
    }
    final transport = await relayClient.connect(relay, ticket: relayTicket);
    final secured = await secure(transport);
    return TransportSelection(
      transport,
      secured,
      relayReason: direct.relayReason,
    );
  }

  @override
  Future<DirectSelection<S>> selectDirect<S>(
    TrustedDevice device, {
    required TransportSecurer<S> secure,
  }) async {
    final direct = await _direct(device, secure);
    return DirectSelection(
      transport: direct.transport,
      secured: direct.secured,
      relayReason: direct.transport == null ? direct.relayReason : null,
    );
  }

  Future<_DirectOutcome<S>> _direct<S>(
    TrustedDevice device,
    TransportSecurer<S> secure,
  ) {
    if (device.hosts.isEmpty) return Future.value(_DirectOutcome<S>());
    final race = _DirectRace<S>(
      _createTransport,
      secure,
      _directTimeout,
      _directHandshakeTimeout,
    )..dialStored(device.hosts);
    final finder = _lanFinder;
    final onLocalNetwork = _onLocalNetwork;
    if (finder != null && onLocalNetwork != null) {
      race.lookNearby(() async {
        if (!await _isOnLocalNetwork(onLocalNetwork)) return null;
        return finder.find(device.macDeviceId, window: _mdnsWindow);
      });
    }
    return race.result;
  }

  static Future<bool> _isOnLocalNetwork(LocalNetworkCheck check) async {
    try {
      return await check();
    } on Object {
      return false;
    }
  }

  /// Builds a `ws://` URL from a bare `host:port`, leaving an explicit
  /// `ws://`/`wss://` scheme untouched.
  static String _directUrl(String host) {
    if (host.startsWith('ws://') || host.startsWith('wss://')) return host;
    return 'ws://$host';
  }
}

/// How a direct attempt ended.
class _DirectOutcome<S> {
  _DirectOutcome({
    this.transport,
    this.secured,
    this.seenNearby = false,
    this.handshakeError,
  });

  final WebSocketTransport? transport;
  final S? secured;
  final bool seenNearby;

  /// The last handshake failure over a direct address, with its stack.
  final (Object, StackTrace)? handshakeError;

  /// Why the relay, when no direct address passed and one was there.
  RelayReason? get relayReason {
    if (transport != null) return null;
    if (handshakeError != null) return RelayReason.directHandshakeFailed;
    if (seenNearby) return RelayReason.sameNetworkUnreachable;
    return null;
  }
}

/// A direct address whose socket is open, waiting for its handshake.
class _Candidate {
  _Candidate(this.transport, {required this.announced});

  final WebSocketTransport transport;

  /// Revealed by mDNS rather than stored.
  final bool announced;
}

/// One attempt at a PC's direct addresses.
///
/// Every address is dialed concurrently — the stored ones at once, any the
/// mDNS look-up reveals the moment it does — so a dead or slow one (an
/// unreachable Tailscale tunnel, a network the PC left) never delays the
/// sockets of the others. Sockets that open become candidates, and ONE
/// handshake runs at a time, in order: stored candidates first; an announced
/// one only once no stored address is still being dialed or waiting. The
/// first handshake to succeed wins; every other transport is disconnected and
/// the look-up cancelled, so exactly one live transport is ever returned. A
/// candidate whose handshake fails is closed and never tried again in this
/// attempt (each URL is dialed once). Without a winner the attempt ends once
/// every dial and handshake is over AND the look-up has ended.
class _DirectRace<S> {
  _DirectRace(
    this._createTransport,
    this._secure,
    this._socketTimeout,
    this._handshakeTimeout,
  );

  final WebSocketTransport Function() _createTransport;
  final TransportSecurer<S> _secure;
  final Duration _socketTimeout;
  final Duration _handshakeTimeout;
  final Completer<_DirectOutcome<S>> _decided = Completer<_DirectOutcome<S>>();
  final Set<String> _dialed = {};
  final Set<WebSocketTransport> _open = {};
  final Queue<_Candidate> _storedReady = Queue<_Candidate>();
  final Queue<_Candidate> _announcedReady = Queue<_Candidate>();
  StreamSubscription<DiscoveredBridge>? _lookup;
  int _storedDialing = 0;
  int _announcedDialing = 0;
  bool _looking = false;
  bool _securing = false;
  bool _seenNearby = false;
  (Object, StackTrace)? _handshakeError;

  Future<_DirectOutcome<S>> get result => _decided.future;

  void dialStored(Iterable<String> hosts) {
    for (final host in hosts) {
      _dial(host, announced: false);
    }
  }

  /// Runs the look-up [open] returns (`null`: none — not on a local network),
  /// dialing every address of every sighting. The attempt cannot end without
  /// a winner while it runs; a winner cancels it.
  void lookNearby(Future<Stream<DiscoveredBridge>?> Function() open) {
    _looking = true;
    unawaited(() async {
      final Stream<DiscoveredBridge>? sightings;
      try {
        sightings = await open();
      } on Object {
        _endLookup();
        return;
      }
      if (sightings == null || _decided.isCompleted) {
        _endLookup();
        return;
      }
      _lookup = sightings.listen(
        (sighting) {
          _seenNearby = true;
          for (final host in sighting.directHosts) {
            _dial(host, announced: true);
          }
        },
        onError: (Object _) {},
        onDone: _endLookup,
      );
    }());
  }

  void _endLookup() {
    _lookup = null;
    _looking = false;
    _next();
  }

  void _dial(String host, {required bool announced}) {
    final url = DirectTransportSelector._directUrl(host);
    if (_decided.isCompleted || !_dialed.add(url)) return;
    announced ? _announcedDialing++ : _storedDialing++;
    final transport = _createTransport();
    _open.add(transport);
    transport.connect(url).timeout(_socketTimeout).then((_) {
      if (_decided.isCompleted) {
        _close(transport); // the attempt already ended
        return;
      }
      (announced ? _announcedReady : _storedReady)
          .add(_Candidate(transport, announced: announced));
    }).catchError((Object _) {
      _close(transport);
    }).whenComplete(() {
      announced ? _announcedDialing-- : _storedDialing--;
      _next();
    });
  }

  /// Hands the next candidate to the handshake, or ends the attempt when
  /// nothing is left to try.
  void _next() {
    if (_decided.isCompleted || _securing) return;
    final _Candidate? candidate;
    if (_storedReady.isNotEmpty) {
      candidate = _storedReady.removeFirst();
    } else if (_announcedReady.isNotEmpty && _storedDialing == 0) {
      candidate = _announcedReady.removeFirst();
    } else {
      candidate = null;
    }
    if (candidate != null) {
      _handshake(candidate);
      return;
    }
    if (_storedDialing == 0 &&
        _announcedDialing == 0 &&
        _announcedReady.isEmpty &&
        !_looking) {
      _finish(null, null);
    }
  }

  void _handshake(_Candidate candidate) {
    _securing = true;
    final transport = candidate.transport;
    _secure(transport).timeout(_handshakeTimeout).then((secured) {
      _securing = false;
      _finish(transport, secured);
    }).catchError((Object error, StackTrace stackTrace) {
      // Not the PC this phone trusts, or not finishing: closed, skipped.
      _handshakeError = (
        error is TimeoutException
            ? const TransportException(
                TransportErrorKind.handshake,
                'The direct handshake did not finish in time',
              )
            : error,
        stackTrace,
      );
      _close(transport);
      _securing = false;
      _next();
    });
  }

  void _finish(WebSocketTransport? winner, S? secured) {
    if (_decided.isCompleted) {
      if (winner != null) _close(winner);
      return;
    }
    _decided.complete(
      _DirectOutcome<S>(
        transport: winner,
        secured: secured,
        seenNearby: _seenNearby,
        handshakeError: _handshakeError,
      ),
    );
    unawaited(_lookup?.cancel());
    _lookup = null;
    for (final transport in [..._open]) {
      if (!identical(transport, winner)) _close(transport);
    }
    _storedReady.clear();
    _announcedReady.clear();
  }

  void _close(WebSocketTransport transport) {
    _open.remove(transport);
    unawaited(transport.disconnect().catchError((_) {}));
  }
}
