import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
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
      }).select(
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
        ).select(
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
      }).select(
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
      ).select(_device(hosts: const ['192.168.1.5:8765'])) as _FakeTransport;

      expect(transport.connectedUrl, _relayPhoneUrl);
    });

    test('passes the pairing ticket to the relay', () async {
      const ticket = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
      final transport = await selector(() => _FakeTransport((_) async {}))
          .select(_device(), relayTicket: ticket) as _FakeTransport;
      expect(transport.relayAuth?['ticket'], ticket);
    });

    test("surfaces the relay's refusal as a typed RelayException", () async {
      await expectLater(
        selector(() => _FakeTransport((_) async {}, relayClose: 4004))
            .select(_device()),
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
        ).select(_device(relay: null, hosts: const ['192.168.1.5:8765'])),
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
        }).select(_device(relay: off, hosts: const ['192.168.1.5:8765'])),
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
          .select(_device()) as _FakeTransport;
      expect(transport.connectedUrl, _relayPhoneUrl);
    });

    test('selectDirect returns a direct host and never dials the relay',
        () async {
      final created = <_FakeTransport>[];
      final transport = await selector(() {
        final t = _FakeTransport((_) async {});
        created.add(t);
        return t;
      }).selectDirect(_device(hosts: const ['192.168.1.5:8765']));

      expect(transport?.connectedUrl, 'ws://192.168.1.5:8765');
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
      ).selectDirect(_device(hosts: const ['192.168.1.5:8765']));

      expect(transport, isNull);
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
      }).selectDirect(_device());

      expect(transport, isNull);
      expect(created, isEmpty);
    });

    test('leaves an explicit ws:// host scheme untouched', () async {
      final transport = await selector(() => _FakeTransport((_) async {}))
              .select(_device(hosts: const ['ws://192.168.1.5:8765']))
          as _FakeTransport;
      expect(transport.connectedUrl, 'ws://192.168.1.5:8765');
    });
  });
}
