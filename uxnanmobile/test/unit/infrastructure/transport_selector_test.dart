import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/infrastructure/transport/transport_selector.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// Records the URL/headers it was asked to connect to and resolves according to
/// [onConnect] — either completing, throwing, or hanging (to exercise the
/// per-host timeout).
class _FakeTransport implements WebSocketTransport {
  _FakeTransport(this.onConnect);

  /// Given a URL, returns a future that completes (success), throws (failure),
  /// or never completes (to trip the timeout).
  final Future<void> Function(String url) onConnect;

  String? connectedUrl;
  Map<String, String>? connectedHeaders;
  bool disconnected = false;

  @override
  Future<void> connect(String url, {Map<String, String>? headers}) {
    connectedUrl = url;
    connectedHeaders = headers;
    return onConnect(url);
  }

  @override
  Future<void> disconnect() async => disconnected = true;

  @override
  Future<void> send(Uint8List data) async {}

  @override
  Stream<Uint8List> get incoming => const Stream.empty();

  @override
  Stream<TransportState> get stateChanges => const Stream.empty();
}

TrustedDevice _device({
  String relayUrl = 'wss://relay.test',
  List<String> hosts = const [],
}) =>
    TrustedDevice(
      macDeviceId: 'mac-1',
      displayName: 'Bridge',
      macIdentityPublicKey: Uint8List(32),
      relayUrl: relayUrl,
      hosts: hosts,
      sessionId: 'session-1',
      pairedAt: DateTime(2026),
    );

void main() {
  group('DirectTransportSelector', () {
    test('connects to the first reachable direct host (no relay headers)',
        () async {
      final created = <_FakeTransport>[];
      final selector = DirectTransportSelector(() {
        final t = _FakeTransport((_) async {});
        created.add(t);
        return t;
      });

      final transport = await selector.select(
        _device(hosts: const ['192.168.1.5:8765', '100.64.0.2:8765']),
      ) as _FakeTransport;

      expect(transport.connectedUrl, 'ws://192.168.1.5:8765');
      expect(transport.connectedHeaders, isNull);
      expect(created, hasLength(1)); // stopped at the first success
    });

    test('falls back to the next host, then the relay', () async {
      final created = <_FakeTransport>[];
      final selector = DirectTransportSelector(() {
        final t = _FakeTransport((url) async {
          if (url.startsWith('ws://')) throw StateError('unreachable');
        });
        created.add(t);
        return t;
      });

      final transport = await selector.select(
        _device(hosts: const ['192.168.1.5:8765', '10.0.0.9:8765']),
      ) as _FakeTransport;

      // Two direct attempts failed (and were disconnected), then the relay.
      expect(created, hasLength(3));
      expect(created[0].disconnected, isTrue);
      expect(created[1].disconnected, isTrue);
      expect(transport.connectedUrl, 'wss://relay.test');
      expect(transport.connectedHeaders, {
        'x-role': 'iphone',
        'x-session-id': 'session-1',
      });
    });

    test('times out a hanging direct host and falls back to the relay',
        () async {
      final selector = DirectTransportSelector(
        () => _FakeTransport((url) async {
          if (url.startsWith('ws://')) {
            return Completer<void>().future; // never completes
          }
        }),
        directTimeout: const Duration(milliseconds: 20),
      );

      final transport = await selector.select(
        _device(hosts: const ['192.168.1.5:8765']),
      ) as _FakeTransport;

      expect(transport.connectedUrl, 'wss://relay.test');
    });

    test('throws when every direct host fails and no relay is set', () async {
      final selector = DirectTransportSelector(
        () => _FakeTransport((_) async => throw StateError('unreachable')),
      );

      expect(
        () => selector.select(
          _device(relayUrl: '', hosts: const ['192.168.1.5:8765']),
        ),
        throwsA(isA<TransportException>()),
      );
    });

    test('uses the relay directly when there are no hosts', () async {
      final selector = DirectTransportSelector(
        () => _FakeTransport((_) async {}),
      );

      final transport = await selector.select(_device()) as _FakeTransport;
      expect(transport.connectedUrl, 'wss://relay.test');
    });

    test('leaves an explicit ws:// host scheme untouched', () async {
      final selector = DirectTransportSelector(
        () => _FakeTransport((_) async {}),
      );

      final transport = await selector.select(
        _device(hosts: const ['ws://192.168.1.5:8765']),
      ) as _FakeTransport;
      expect(transport.connectedUrl, 'ws://192.168.1.5:8765');
    });
  });
}
