import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:async/async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
import 'package:uxnan/infrastructure/crypto/handshake_crypto.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
import 'package:uxnan/infrastructure/transport/relay_client.dart';
import 'package:uxnan/infrastructure/transport/relay_protocol.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

const _routingId = '0123456789abcdef0123456789abcdef';
const _ticket = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const _endpoint = RelayEndpoint(
  url: 'wss://uxnan-relay.example.workers.dev',
  routingId: _routingId,
  enabled: true,
);

/// A phone's socket to a relay room that answers exactly as
/// `relay/src/room.ts` does for the phone route: a `challenge` the moment the
/// socket opens, a `phone-auth` frame verified against the signing message,
/// then `ready` — or a close with one of `RELAY_CLOSE`'s codes. Once ready it
/// is a pipe to a stand-in bridge that echoes every frame.
class _FakeRelayRoom implements WebSocketTransport {
  _FakeRelayRoom({
    this.allowedKeys = const {},
    this.ticket,
    this.bridgeOnline = true,
    this.answerReady = true,
    this.closeOnOpen,
    this.version = 1,
    this.pongFirst = false,
    this.refuseConnect = false,
  });

  final Set<String> allowedKeys;
  final String? ticket;
  final bool bridgeOnline;
  final bool answerReady;
  final int? closeOnOpen;
  final int version;
  final bool pongFirst;
  final bool refuseConnect;

  final String nonce = 'ab' * 32;
  final List<String> textSent = [];
  final List<Uint8List> binarySent = [];
  String? url;
  bool paired = false;

  // Frames the room sends before anyone listens are kept, as the real
  // transport keeps them.
  final List<Uint8List> _unheard = [];
  bool _closedUnheard = false;
  late final StreamController<Uint8List> _incoming =
      StreamController<Uint8List>.broadcast(onListen: _flush);

  void _flush() {
    final frames = List.of(_unheard);
    _unheard.clear();
    frames.forEach(_incoming.add);
    if (_closedUnheard) unawaited(_incoming.close());
  }

  void _emit(String text) {
    final bytes = Uint8List.fromList(utf8.encode(text));
    if (_incoming.hasListener) {
      _incoming.add(bytes);
    } else {
      _unheard.add(bytes);
    }
  }

  void _close(int code) {
    closeCode = code;
    if (_incoming.hasListener || _unheard.isEmpty) {
      unawaited(_incoming.close());
    } else {
      _closedUnheard = true;
    }
  }

  @override
  int? closeCode;

  @override
  String? get connectedUrl => url;

  @override
  Stream<Uint8List> get incoming => _incoming.stream;

  @override
  Stream<TransportState> get stateChanges => const Stream.empty();

  @override
  Future<void> connect(String url) async {
    if (refuseConnect) throw StateError('connection refused');
    this.url = url;
    final uri = Uri.parse(url);
    if (uri.path != '/v1/connect/$_routingId') throw StateError('404');
    if (pongFirst) _emit('pong');
    _emit(jsonEncode({'t': 'challenge', 'v': version, 'nonce': nonce}));
    if (closeOnOpen != null) _close(closeOnOpen!);
  }

  @override
  Future<void> sendText(String text) async {
    // A socket the room already closed delivers nothing.
    if (closeCode != null) return;
    textSent.add(text);
    if (paired) return _emit(text);
    final frame = jsonDecode(text) as Map<String, dynamic>;
    final onlyKnownKeys =
        frame.keys.every(const {'t', 'key', 'sig', 'ticket'}.contains);
    if (frame['t'] != 'phone-auth' || !onlyKnownKeys) {
      return _close(4001);
    }
    final key = frame['key'] as String;
    final message = 'uxnan-relay-v1|phone|${Uri.parse(url!).host}|'
        '$_routingId||$nonce';
    final ok = await HandshakeCrypto().verify(
      Uint8List.fromList(utf8.encode(message)),
      (frame['sig'] as String).fromHex(),
      key.fromHex(),
    );
    if (!ok) return _close(4001);
    final viaTicket = ticket != null && frame['ticket'] == ticket;
    if (!allowedKeys.contains(key) && !viaTicket) return _close(4003);
    if (!bridgeOnline) return _close(4004);
    if (!answerReady) return;
    paired = true;
    _emit(jsonEncode({'t': 'ready'}));
  }

  @override
  Future<void> send(Uint8List data) async {
    binarySent.add(data);
    // Before `ready` the room only reads text control frames.
    if (!paired) return _close(4008);
    if (_incoming.hasListener) {
      _incoming.add(data);
    } else {
      _unheard.add(data);
    }
  }

  @override
  Future<void> disconnect() async {
    if (!_incoming.isClosed) await _incoming.close();
  }
}

void main() {
  late PhoneIdentity phone;

  setUp(() async {
    final keys = await KeyGeneration().generateIdentityKeyPair();
    phone = PhoneIdentity(
      phoneDeviceId: 'phone-1',
      publicKey: keys.publicKey,
      privateSeed: keys.privateSeed,
    );
  });

  RelayClient client(
    _FakeRelayRoom room, {
    Duration readyTimeout = const Duration(seconds: 15),
  }) =>
      RelayClient(
        createTransport: () => room,
        identity: () async => phone,
        readyTimeout: readyTimeout,
      );

  group('RelayProtocol', () {
    test('signs exactly what shared relaySigningMessage builds', () {
      // relaySigningMessage({route: 'phone', host, routingId, nonce}) from
      // shared/src/relay/protocol.ts, for these inputs.
      expect(
        RelayProtocol.phoneSigningMessage(
          host: 'uxnan-relay.gamas.workers.dev',
          routingId: _routingId,
          nonce: 'ab' * 32,
        ),
        'uxnan-relay-v1|phone|uxnan-relay.gamas.workers.dev|'
        '0123456789abcdef0123456789abcdef||'
        'abababababababababababababababababababababababababababababababab',
      );
    });

    test('takes the host as the relay sees it (URL.host)', () {
      expect(
        RelayProtocol.hostOf('wss://uxnan-relay.gamas.workers.dev/v1/x'),
        'uxnan-relay.gamas.workers.dev',
      );
      expect(RelayProtocol.hostOf('wss://relay.example:443'), 'relay.example');
      expect(
        RelayProtocol.hostOf('wss://relay.example:8443'),
        'relay.example:8443',
      );
      expect(RelayProtocol.hostOf('ws://127.0.0.1:8787'), '127.0.0.1:8787');
      expect(RelayProtocol.hostOf('ws://relay.example:80'), 'relay.example');
      expect(RelayProtocol.hostOf('ws://[::1]:9000'), '[::1]:9000');
    });

    test('dials the phone route', () {
      expect(
        RelayProtocol.phoneUrl(_endpoint),
        'wss://uxnan-relay.example.workers.dev/v1/connect/$_routingId',
      );
    });
  });

  group('RelayClient', () {
    test('a trusted phone: challenge, signed auth as text, ready', () async {
      final room = _FakeRelayRoom(allowedKeys: {phone.publicKey.toHex()});

      final transport = await client(room).connect(_endpoint);

      expect(identical(transport, room), isTrue);
      expect(
        room.url,
        'wss://uxnan-relay.example.workers.dev/v1/connect/$_routingId',
      );
      final auth = jsonDecode(room.textSent.single) as Map<String, dynamic>;
      expect(auth.keys, unorderedEquals(['t', 'key', 'sig']));
      expect(auth['key'], phone.publicKey.toHex());
      expect(room.paired, isTrue);
      // Nothing went out as binary before the relay said ready.
      expect(room.binarySent, isEmpty);
    });

    test('then it is a plain pipe for the E2EE layer', () async {
      final room = _FakeRelayRoom(allowedKeys: {phone.publicKey.toHex()});
      final transport = await client(room).connect(_endpoint);

      final frames = StreamQueue<Uint8List>(transport.incoming);
      final hello = Uint8List.fromList(utf8.encode('{"kind":"clientHello"}'));
      await transport.send(hello);
      expect(await frames.next, hello);
      await frames.cancel();
    });

    test("a phone pairing through the relay presents the QR's ticket",
        () async {
      final room = _FakeRelayRoom(ticket: _ticket);

      await client(room).connect(_endpoint, ticket: _ticket);

      final auth = jsonDecode(room.textSent.single) as Map<String, dynamic>;
      expect(auth['ticket'], _ticket);
      expect(room.paired, isTrue);
    });

    test('skips a stray keepalive pong', () async {
      final room = _FakeRelayRoom(
        allowedKeys: {phone.publicKey.toHex()},
        pongFirst: true,
      );
      await client(room).connect(_endpoint);
      expect(room.paired, isTrue);
    });

    test('an untrusted phone without a ticket is refused: notAllowed',
        () async {
      final room = _FakeRelayRoom();
      await expectLater(
        client(room).connect(_endpoint),
        throwsA(
          isA<RelayException>()
              .having((e) => e.failure, 'failure', RelayFailure.notAllowed)
              .having((e) => e.kind, 'kind', TransportErrorKind.connection),
        ),
      );
    });

    test('a PC whose bridge is not connected: bridgeOffline', () async {
      final room = _FakeRelayRoom(
        allowedKeys: {phone.publicKey.toHex()},
        bridgeOnline: false,
      );
      await expectLater(
        client(room).connect(_endpoint),
        throwsA(
          isA<RelayException>().having(
            (e) => e.failure,
            'failure',
            RelayFailure.bridgeOffline,
          ),
        ),
      );
    });

    for (final failure in RelayFailure.values) {
      final code = failure.closeCode;
      if (code == null) continue;
      test('close code $code reads as ${failure.name}', () async {
        final room = _FakeRelayRoom(closeOnOpen: code);
        await expectLater(
          client(room).connect(_endpoint),
          throwsA(
            isA<RelayException>().having((e) => e.failure, 'failure', failure),
          ),
        );
      });
    }

    test('an unknown close code reads as unreachable', () {
      expect(RelayFailure.fromCloseCode(1006), RelayFailure.unreachable);
      expect(RelayFailure.fromCloseCode(null), RelayFailure.unreachable);
    });

    test('no ready in time: bridgeTimeout, and the socket is closed', () async {
      final room = _FakeRelayRoom(
        allowedKeys: {phone.publicKey.toHex()},
        answerReady: false,
      );
      await expectLater(
        client(room, readyTimeout: const Duration(milliseconds: 50))
            .connect(_endpoint),
        throwsA(
          isA<RelayException>().having(
            (e) => e.failure,
            'failure',
            RelayFailure.bridgeTimeout,
          ),
        ),
      );
      expect(room.closeCode, isNull); // closed by the phone, not the room
    });

    test('another control protocol version: protocol', () async {
      final room = _FakeRelayRoom(
        allowedKeys: {phone.publicKey.toHex()},
        version: 2,
      );
      await expectLater(
        client(room).connect(_endpoint),
        throwsA(
          isA<RelayException>()
              .having((e) => e.failure, 'failure', RelayFailure.protocol),
        ),
      );
      expect(room.textSent, isEmpty); // it never signed anything
    });

    test('a relay that cannot be reached: unreachable', () async {
      final room = _FakeRelayRoom(refuseConnect: true);
      await expectLater(
        client(room).connect(_endpoint),
        throwsA(
          isA<RelayException>()
              .having((e) => e.failure, 'failure', RelayFailure.unreachable),
        ),
      );
    });
  });
}
