import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:stream_channel/stream_channel.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// A socket whose network vanished: it opened fine, but its closing handshake
/// is never answered.
class _DeadSocketChannel
    with StreamChannelMixin<dynamic>
    implements WebSocketChannel {
  final _incoming = StreamController<dynamic>();

  @override
  Stream<dynamic> get stream => _incoming.stream;

  @override
  final WebSocketSink sink = _NeverClosingSink();

  @override
  Future<void> get ready => Future<void>.value();

  @override
  int? get closeCode => null;

  @override
  String? get closeReason => null;

  @override
  String? get protocol => null;
}

class _NeverClosingSink implements WebSocketSink {
  @override
  void add(dynamic data) {}

  @override
  void addError(Object error, [StackTrace? stackTrace]) {}

  @override
  Future<void> addStream(Stream<dynamic> stream) => Future<void>.value();

  @override
  Future<void> close([int? closeCode, String? closeReason]) =>
      Completer<void>().future;

  @override
  Future<void> get done => Completer<void>().future;
}

void main() {
  test('disconnect does not wait forever on a socket that never answers',
      () async {
    final transport = WebSocketChannelTransport(
      openChannel: (_) => _DeadSocketChannel(),
      closeTimeout: const Duration(milliseconds: 50),
    );
    await transport.connect('wss://relay.example/v1/connect/x');
    expect(transport.connectedUrl, 'wss://relay.example/v1/connect/x');

    await transport.disconnect().timeout(const Duration(seconds: 2));
    expect(transport.connectedUrl, isNull);
  });
}
