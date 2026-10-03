import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/entities/discovered_bridge.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/relay_reason.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
import 'package:uxnan/infrastructure/discovery/bridge_discovery_service.dart';
import 'package:uxnan/infrastructure/transport/relay_client.dart';
import 'package:uxnan/infrastructure/transport/transport_selector.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

const _relay = RelayEndpoint(
  url: 'wss://relay.test',
  routingId: '0123456789abcdef0123456789abcdef',
  enabled: true,
);
const _relayPhoneUrl =
    'wss://relay.test/v1/connect/0123456789abcdef0123456789abcdef';

/// Records the URL it was asked to connect to and resolves according to
/// [onConnect] — either completing, throwing, or hanging (to exercise the
/// per-host timeout). Dialled at the relay's phone route, it answers like the
/// relay (`relay/src/room.ts`): a challenge, then `ready` once authenticated,
/// or [relayClose] — without checking the signature, which
/// `relay_client_test.dart` covers.
class _FakeTransport implements WebSocketTransport {
  _FakeTransport(this.onConnect, {this.relayClose});

  /// Given a URL, returns a future that completes (success), throws (failure),
  /// or never completes (to trip the timeout).
  final Future<void> Function(String url) onConnect;

  /// The close code the relay answers the auth frame with, if it refuses.
  final int? relayClose;

  @override
  String? connectedUrl;
  bool disconnected = false;
  Map<String, dynamic>? relayAuth;

  final List<Uint8List> _unheard = [];
  late final StreamController<Uint8List> _incoming =
      StreamController<Uint8List>.broadcast(
    onListen: () => _unheard
      ..forEach(_incoming.add)
      ..clear(),
  );

  void _emit(Map<String, Object> frame) {
    final bytes = Uint8List.fromList(utf8.encode(jsonEncode(frame)));
    _incoming.hasListener ? _incoming.add(bytes) : _unheard.add(bytes);
  }

  @override
  int? closeCode;

  @override
  Future<void> connect(String url) async {
    connectedUrl = url;
    await onConnect(url);
    if (url.contains('/v1/connect/')) {
      _emit({'t': 'challenge', 'v': 1, 'nonce': 'cd' * 32});
    }
  }

  @override
  Future<void> sendText(String text) async {
    relayAuth = jsonDecode(text) as Map<String, dynamic>;
    final code = relayClose;
    if (code != null) {
      closeCode = code;
      unawaited(_incoming.close());
    } else {
      _emit({'t': 'ready'});
    }
  }

  @override
  Future<void> disconnect() async => disconnected = true;

  @override
  Future<void> send(Uint8List data) async {}

  @override
  Stream<Uint8List> get incoming => _incoming.stream;

  @override
  Stream<TransportState> get stateChanges => const Stream.empty();
}

/// What a bridge advertises on `_uxnan._tcp`, parsed exactly as a real
/// sighting is: the TXT keys of `bridge/src/transport/mdns-advertiser.ts`
/// (`v`, `id`, `port`, `addr` — the first advertised address) and the A
/// records the platform resolved.
DiscoveredBridge _advertised({
  required String id,
  required List<String> addresses,
  int port = 19850,
}) {
  Uint8List txt(String v) => Uint8List.fromList(utf8.encode(v));
  return parseDiscoveredBridge(
    name: 'Studio',
    host: 'Studio.local',
    port: port,
    addresses: [for (final a in addresses) InternetAddress(a)],
    txt: {
      'v': txt('1'),
      'id': txt(id),
      'port': txt('$port'),
      'addr': txt(addresses.first),
    },
  )!;
}

/// A browse that reports [sightings] (every service on the network, as the
/// platform lists them) [after] it starts — the seam [MdnsLanBridgeFinder]
/// drives instead of the platform's.
class _FakeDiscovery implements BridgeDiscoveryService {
  _FakeDiscovery(this.sightings, {this.after = Duration.zero});

  final List<DiscoveredBridge> sightings;
  final Duration after;
  final StreamController<List<DiscoveredBridge>> _controller =
      StreamController<List<DiscoveredBridge>>.broadcast();
  bool started = false;
  bool disposed = false;

  @override
  Stream<List<DiscoveredBridge>> get bridges => _controller.stream;

  @override
  Future<void> start() async {
    started = true;
    Timer(after, () {
      if (!_controller.isClosed) _controller.add(sightings);
    });
  }

  @override
  Future<void> dispose() async {
    disposed = true;
    await _controller.close();
  }
}

/// A handshake that every peer passes — the selector tests are about which
/// sockets are tried; the session tests run the real handshake.
Future<WebSocketTransport> _accept(WebSocketTransport transport) async =>
    transport;

/// The connected transport of a [TransportSelector.select].
extension on TransportSelector {
  Future<WebSocketTransport> pick(
    TrustedDevice device, {
    String? relayTicket,
  }) async =>
      (await select(device, relayTicket: relayTicket, secure: _accept))
          .transport;
}

TrustedDevice _device({
  RelayEndpoint? relay = _relay,
  List<String> hosts = const [],
}) =>
    TrustedDevice(
      macDeviceId: 'mac-1',
      displayName: 'Bridge',
      macIdentityPublicKey: Uint8List(32),
      relay: relay,
      hosts: hosts,
      sessionId: 'session-1',
      pairedAt: DateTime(2026),
    );

void main() {
  late PhoneIdentity phone;

  setUpAll(() async {
    final keys = await KeyGeneration().generateIdentityKeyPair();
    phone = PhoneIdentity(
      phoneDeviceId: 'phone-1',
      publicKey: keys.publicKey,
      privateSeed: keys.privateSeed,
    );
  });

  /// A selector whose direct and relay dials both come from [create].
  DirectTransportSelector selector(
    _FakeTransport Function() create, {
    Duration directTimeout = const Duration(seconds: 2),
  }) =>
      DirectTransportSelector(
        create,
        relayClient: RelayClient(
          createTransport: create,
          identity: () async => phone,
        ),
        directTimeout: directTimeout,
      );

  group('DirectTransportSelector', () {
    test('connects to a reachable direct host, never the relay', () async {
      final created = <_FakeTransport>[];
      final transport = await selector(() {
        final t = _FakeTransport((_) async {});
        created.add(t);
        return t;
      }).pick(
        _device(hosts: const ['192.168.1.5:8765', '100.64.0.2:8765']),
      ) as _FakeTransport;

      // A direct ws:// host won (never the relay).
      expect(
        transport.connectedUrl,
        anyOf('ws://192.168.1.5:8765', 'ws://100.64.0.2:8765'),
      );
      expect(transport.relayAuth, isNull);
      // Both hosts were dialed concurrently; the loser was disconnected so only
      // the winner stays open.
      expect(created, hasLength(2));
      expect(created.where((t) => !t.disconnected), hasLength(1));
    });

    test(
      'a hanging host does not block a reachable one (parallel dial)',
      () async {
        // host[0] never completes; host[1] connects. Serial dialing would wait
        // out host[0]'s full 30 s timeout first (hanging the test past its own
        // 5 s budget); parallel dialing returns host[1] at once.
        final transport = await selector(
          () => _FakeTransport((url) async {
            if (url.contains('192.168.1.5')) {
              return Completer<void>().future; // never completes
            }
          }),
          directTimeout: const Duration(seconds: 30),
        ).pick(
          _device(hosts: const ['192.168.1.5:8765', '10.0.0.9:8765']),
        ) as _FakeTransport;

        expect(transport.connectedUrl, 'ws://10.0.0.9:8765');
      },
      timeout: const Timeout(Duration(seconds: 5)),
    );

    test('falls back to the next host, then the relay', () async {
      final created = <_FakeTransport>[];
      final transport = await selector(() {
        final t = _FakeTransport((url) async {
          if (url.startsWith('ws://')) throw StateError('unreachable');
        });
        created.add(t);
        return t;
      }).pick(
        _device(hosts: const ['192.168.1.5:8765', '10.0.0.9:8765']),
      ) as _FakeTransport;

      // Two direct attempts failed (and were disconnected), then the relay's
      // phone route, authenticated before it was handed back.
      expect(created, hasLength(3));
      expect(created[0].disconnected, isTrue);
      expect(created[1].disconnected, isTrue);
      expect(transport.connectedUrl, _relayPhoneUrl);
      expect(transport.relayAuth?['t'], 'phone-auth');
      expect(transport.relayAuth?.containsKey('ticket'), isFalse);
    });

    test('times out a hanging direct host and falls back to the relay',
        () async {
      final transport = await selector(
        () => _FakeTransport((url) async {
          if (url.startsWith('ws://')) {
            return Completer<void>().future; // never completes
          }
        }),
        directTimeout: const Duration(milliseconds: 20),
      ).pick(_device(hosts: const ['192.168.1.5:8765'])) as _FakeTransport;

      expect(transport.connectedUrl, _relayPhoneUrl);
    });

    test('passes the pairing ticket to the relay', () async {
      const ticket = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
      final transport = await selector(() => _FakeTransport((_) async {}))
          .pick(_device(), relayTicket: ticket) as _FakeTransport;
      expect(transport.relayAuth?['ticket'], ticket);
    });

    test("surfaces the relay's refusal as a typed RelayException", () async {
      await expectLater(
        selector(() => _FakeTransport((_) async {}, relayClose: 4004))
            .pick(_device()),
        throwsA(
          isA<RelayException>().having(
            (e) => e.failure,
            'failure',
            RelayFailure.bridgeOffline,
          ),
        ),
      );
    });

    test('throws when every direct host fails and no relay is set', () async {
      expect(
        () => selector(
          () => _FakeTransport((_) async => throw StateError('unreachable')),
        ).pick(_device(relay: null, hosts: const ['192.168.1.5:8765'])),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.noRoute,
          ),
        ),
      );
    });

    test('never dials a relay the bridge switched off', () async {
      final created = <_FakeTransport>[];
      const off = RelayEndpoint(
        url: 'wss://relay.test',
        routingId: '0123456789abcdef0123456789abcdef',
        enabled: false,
      );
      await expectLater(
        selector(() {
          final t = _FakeTransport((url) async {
            if (url.startsWith('ws://')) throw StateError('unreachable');
          });
          created.add(t);
          return t;
        }).pick(_device(relay: off, hosts: const ['192.168.1.5:8765'])),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.noRoute,
          ),
        ),
      );
      expect(created.map((t) => t.connectedUrl), ['ws://192.168.1.5:8765']);
    });

    test('uses the relay directly when there are no hosts', () async {
      final transport = await selector(() => _FakeTransport((_) async {}))
          .pick(_device()) as _FakeTransport;
      expect(transport.connectedUrl, _relayPhoneUrl);
    });

    test('selectDirect returns a direct host and never dials the relay',
        () async {
      final created = <_FakeTransport>[];
      final transport = await selector(() {
        final t = _FakeTransport((_) async {});
        created.add(t);
        return t;
      }).selectDirect(
        _device(hosts: const ['192.168.1.5:8765']),
        secure: _accept,
      );

      expect(transport.transport?.connectedUrl, 'ws://192.168.1.5:8765');
      expect(created.map((t) => t.connectedUrl), ['ws://192.168.1.5:8765']);
    });

    test('selectDirect answers null when no direct host answers', () async {
      final created = <_FakeTransport>[];
      final transport = await selector(
        () {
          final t = _FakeTransport((url) async {
            if (url.startsWith('ws://')) throw StateError('unreachable');
          });
          created.add(t);
          return t;
        },
      ).selectDirect(
        _device(hosts: const ['192.168.1.5:8765']),
        secure: _accept,
      );

      expect(transport.transport, isNull);
      expect(transport.relayReason, isNull);
      // The relay was never dialed, and the failed host was let go.
      expect(created, hasLength(1));
      expect(created.single.disconnected, isTrue);
    });

    test('selectDirect answers null for a PC with no direct hosts', () async {
      final created = <_FakeTransport>[];
      final transport = await selector(() {
        final t = _FakeTransport((_) async {});
        created.add(t);
        return t;
      }).selectDirect(
        _device(),
        secure: _accept,
      );

      expect(transport.transport, isNull);
      expect(created, isEmpty);
    });

    test('leaves an explicit ws:// host scheme untouched', () async {
      final transport = await selector(() => _FakeTransport((_) async {}))
              .pick(_device(hosts: const ['ws://192.168.1.5:8765']))
          as _FakeTransport;
      expect(transport.connectedUrl, 'ws://192.168.1.5:8765');
    });
  });

  group('looking for the PC on the local network (mDNS)', () {
    const stored = '192.168.18.22:19850'; // where the PC was paired
    const moved = '192.168.100.140'; // where it listens now

    late List<_FakeDiscovery> browses;
    late List<_FakeTransport> created;

    setUp(() {
      browses = [];
      created = [];
    });

    /// A selector on a network of [kind], whose browse reports [sightings]
    /// [after] it starts, and where only [answering] addresses answer.
    DirectTransportSelector onNetwork(
      List<DiscoveredBridge> sightings, {
      Set<String> answering = const {},
      bool hanging = false,
      bool local = true,
      Duration after = Duration.zero,
      Duration answerAfter = Duration.zero,
      Duration directTimeout = const Duration(milliseconds: 200),
      Duration window = const Duration(milliseconds: 300),
      Duration handshakeTimeout = const Duration(seconds: 2),
      int? relayClose,
    }) {
      _FakeTransport create() {
        final t = _FakeTransport(
          (url) async {
            if (!url.startsWith('ws://')) return; // the relay
            if (answering.any(url.contains)) {
              return Future<void>.delayed(answerAfter);
            }
            if (hanging) return Completer<void>().future;
            throw StateError('unreachable');
          },
          relayClose: relayClose,
        );
        created.add(t);
        return t;
      }

      return DirectTransportSelector(
        create,
        relayClient: RelayClient(
          createTransport: create,
          identity: () async => phone,
        ),
        lanFinder: MdnsLanBridgeFinder(
          createService: () {
            final browse = _FakeDiscovery(sightings, after: after);
            browses.add(browse);
            return browse;
          },
        ),
        onLocalNetwork: () async => local,
        directTimeout: directTimeout,
        directHandshakeTimeout: handshakeTimeout,
        mdnsWindow: window,
      );
    }

    test('dials the address the PC announces when the stored one fails',
        () async {
      final transport = await onNetwork(
        [
          _advertised(id: 'mac-1', addresses: const [moved]),
        ],
        answering: {moved},
      ).pick(_device(hosts: const [stored])) as _FakeTransport;

      expect(transport.connectedUrl, 'ws://$moved:19850');
      expect(transport.relayAuth, isNull, reason: 'never the relay');
      await pumpEventQueue();
      expect(browses.single.disposed, isTrue, reason: 'the browse stops');
    });

    test(
      'an announced address waits for the stored ones only as long as their '
      'socket timeout',
      () async {
        // The stored Tailscale address hangs until its socket timeout; the LAN
        // address the PC announces answers at once, and gets its turn as soon
        // as no stored address is left in play.
        final watch = Stopwatch()..start();
        final transport = await onNetwork(
          [
            _advertised(id: 'mac-1', addresses: const [moved]),
          ],
          answering: {moved},
          hanging: true,
          directTimeout: const Duration(milliseconds: 300),
          window: const Duration(seconds: 30),
        ).pick(_device(hosts: const ['100.76.97.16:19850'])) as _FakeTransport;

        expect(transport.connectedUrl, 'ws://$moved:19850');
        expect(
          watch.elapsed,
          greaterThanOrEqualTo(const Duration(milliseconds: 300)),
        );
      },
      timeout: const Timeout(Duration(seconds: 5)),
    );

    test('reaches the PC directly even with its relay down', () async {
      final transport = await onNetwork(
        [
          _advertised(id: 'mac-1', addresses: const [moved]),
        ],
        answering: {moved},
        relayClose: 4004,
      ).pick(_device(hosts: const [stored])) as _FakeTransport;

      expect(transport.connectedUrl, 'ws://$moved:19850');
    });

    test('another PC on the same network is never dialed', () async {
      final selection = await onNetwork(
        [
          _advertised(id: 'someone-elses-pc', addresses: const [moved]),
        ],
        answering: {moved},
      ).select(
        _device(hosts: const [stored]),
        secure: _accept,
      );

      expect(selection.transport.connectedUrl, _relayPhoneUrl);
      expect(selection.relayReason, isNull);
      expect(
        created.map((t) => t.connectedUrl),
        isNot(contains('ws://$moved:19850')),
      );
    });

    test('nothing announced within the window: the relay, with no reason',
        () async {
      final watch = Stopwatch()..start();
      final selection = await onNetwork(const []).select(
        _device(hosts: const [stored]),
        secure: _accept,
      );

      expect(selection.transport.connectedUrl, _relayPhoneUrl);
      expect(selection.relayReason, isNull);
      // The race waited for the browse window, and the browse was stopped.
      expect(
        watch.elapsed,
        greaterThanOrEqualTo(const Duration(milliseconds: 300)),
      );
      expect(browses.single.disposed, isTrue);
    });

    test('seen here but not answering: the relay, saying why', () async {
      final selection = await onNetwork(
        [
          _advertised(id: 'mac-1', addresses: const [moved]),
        ],
      ).select(
        _device(hosts: const [stored]),
        secure: _accept,
      );

      expect(selection.transport.connectedUrl, _relayPhoneUrl);
      expect(selection.relayReason, RelayReason.sameNetworkUnreachable);
      expect(
        created.map((t) => t.connectedUrl),
        containsAll(['ws://$stored', 'ws://$moved:19850']),
      );

      final direct = await onNetwork(
        [
          _advertised(id: 'mac-1', addresses: const [moved]),
        ],
      ).selectDirect(
        _device(hosts: const [stored]),
        secure: _accept,
      );
      expect(direct.transport, isNull);
      expect(direct.relayReason, RelayReason.sameNetworkUnreachable);
    });

    test('on cellular alone nothing is browsed', () async {
      final selection = await onNetwork(
        [
          _advertised(id: 'mac-1', addresses: const [moved]),
        ],
        answering: {moved},
        local: false,
      ).select(
        _device(hosts: const [stored]),
        secure: _accept,
      );

      expect(selection.transport.connectedUrl, _relayPhoneUrl);
      expect(browses, isEmpty);
    });

    test(
      'a stored address that answers stops the browse at once',
      () async {
        final transport = await onNetwork(
          [
            _advertised(id: 'mac-1', addresses: const [moved]),
          ],
          answering: {stored},
          // Answers once the browse is under way.
          answerAfter: const Duration(milliseconds: 50),
          after: const Duration(seconds: 30),
          window: const Duration(seconds: 30),
        ).pick(_device(hosts: const [stored])) as _FakeTransport;

        expect(transport.connectedUrl, 'ws://$stored');
        await pumpEventQueue();
        expect(browses.single.started, isTrue);
        expect(browses.single.disposed, isTrue);
      },
      timeout: const Timeout(Duration(seconds: 5)),
    );

    test('a PC with no direct address at all is not looked for', () async {
      final direct = await onNetwork(
        [
          _advertised(id: 'mac-1', addresses: const [moved]),
        ],
        answering: {moved},
      ).selectDirect(
        _device(),
        secure: _accept,
      );

      expect(direct.transport, isNull);
      expect(browses, isEmpty);
    });
  });

  group('a direct address only counts once its handshake succeeds', () {
    const spoof = '192.168.100.66';
    const pc = '192.168.100.140';

    late List<String> handshaken;

    setUp(() => handshaken = []);

    /// The phone's handshake as far as the selector sees it: the PC passes,
    /// [spoofs] (a device that accepts the socket but is not the PC) fail,
    /// and [silent] ones never finish.
    TransportSecurer<String> handshake({
      Set<String> spoofs = const {},
      Set<String> silent = const {},
    }) =>
        (transport) async {
          final url = transport.connectedUrl!;
          handshaken.add(url);
          if (silent.any(url.contains)) return Completer<String>().future;
          if (spoofs.any(url.contains)) {
            throw const TransportException(
              TransportErrorKind.handshake,
              'Bridge identity public key mismatch',
            );
          }
          return 'session over $url';
        };

    DirectTransportSelector selectorOn({
      List<DiscoveredBridge> sightings = const [],
      Map<String, Duration> answerAfter = const {},
      Duration handshakeTimeout = const Duration(seconds: 2),
      bool withRelay = true,
    }) {
      _FakeTransport create() => _FakeTransport((url) async {
            if (!url.startsWith('ws://')) return; // the relay
            for (final MapEntry(:key, :value) in answerAfter.entries) {
              if (url.contains(key)) return Future<void>.delayed(value);
            }
            throw StateError('unreachable');
          });
      return DirectTransportSelector(
        create,
        relayClient: withRelay
            ? RelayClient(
                createTransport: create,
                identity: () async => phone,
              )
            : null,
        lanFinder: _StaticFinder(sightings),
        onLocalNetwork: () async => true,
        directTimeout: const Duration(milliseconds: 200),
        directHandshakeTimeout: handshakeTimeout,
        mdnsWindow: const Duration(milliseconds: 100),
      );
    }

    test('a stored host that fails its handshake gives way to the next one',
        () async {
      final selection = await selectorOn(
        answerAfter: {
          spoof: Duration.zero,
          pc: const Duration(milliseconds: 20),
        },
      ).select(
        _device(hosts: const ['$spoof:19850', '$pc:19850']),
        secure: handshake(spoofs: {spoof}),
      );

      expect(selection.transport.connectedUrl, 'ws://$pc:19850');
      expect(selection.secured, 'session over ws://$pc:19850');
      expect(selection.relayReason, isNull);
      expect(handshaken, ['ws://$spoof:19850', 'ws://$pc:19850']);
    });

    test('an announced peer that fails its handshake: the relay, same attempt',
        () async {
      final selection = await selectorOn(
        sightings: [
          _advertised(id: 'mac-1', addresses: const [spoof]),
        ],
        answerAfter: {spoof: Duration.zero},
      ).select(
        _device(hosts: const ['192.168.18.22:19850']),
        secure: handshake(spoofs: {spoof}),
      );

      expect(selection.transport.connectedUrl, _relayPhoneUrl);
      expect(selection.secured, 'session over $_relayPhoneUrl');
      expect(selection.relayReason, RelayReason.directHandshakeFailed);
      expect(handshaken, ['ws://$spoof:19850', _relayPhoneUrl]);
    });

    test('a peer that never finishes its handshake is skipped in time',
        () async {
      final selection = await selectorOn(
        answerAfter: {spoof: Duration.zero},
        handshakeTimeout: const Duration(milliseconds: 50),
      ).select(
        _device(hosts: const ['$spoof:19850']),
        secure: handshake(silent: {spoof}),
      );

      expect(selection.transport.connectedUrl, _relayPhoneUrl);
      expect(selection.relayReason, RelayReason.directHandshakeFailed);
    });

    test('with no relay, a spoofed peer ends the attempt with its typed error',
        () async {
      await expectLater(
        selectorOn(
          sightings: [
            _advertised(id: 'mac-1', addresses: const [spoof]),
          ],
          answerAfter: {spoof: Duration.zero},
          withRelay: false,
        ).select(
          _device(relay: null, hosts: const ['192.168.18.22:19850']),
          secure: handshake(spoofs: {spoof}),
        ),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.handshake,
          ),
        ),
      );
      // Each address once: the attempt ended, it did not keep retrying.
      expect(handshaken, ['ws://$spoof:19850']);
    });

    test('a stored candidate is handshaken before an announced one', () async {
      final selection = await selectorOn(
        sightings: [
          _advertised(id: 'mac-1', addresses: const [spoof]),
        ],
        answerAfter: {
          spoof: Duration.zero,
          pc: const Duration(milliseconds: 40),
        },
      ).select(
        _device(hosts: const ['$pc:19850']),
        secure: handshake(spoofs: {spoof}),
      );

      expect(selection.transport.connectedUrl, 'ws://$pc:19850');
      expect(handshaken, ['ws://$pc:19850'], reason: 'the spoof never got one');
    });

    test('selectDirect skips a failed handshake and says why it stayed',
        () async {
      final direct = await selectorOn(
        answerAfter: {spoof: Duration.zero},
      ).selectDirect(
        _device(hosts: const ['$spoof:19850']),
        secure: handshake(spoofs: {spoof}),
      );

      expect(direct.transport, isNull);
      expect(direct.secured, isNull);
      expect(direct.relayReason, RelayReason.directHandshakeFailed);
    });
  });
}

/// Sightings that are already there when the look-up starts.
class _StaticFinder implements LanBridgeFinder {
  _StaticFinder(this.sightings);

  final List<DiscoveredBridge> sightings;

  @override
  Stream<DiscoveredBridge> find(String deviceId, {required Duration window}) =>
      Stream.fromIterable([
        for (final s in sightings)
          if (s.deviceId == deviceId) s,
      ]);
}
