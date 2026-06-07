import 'dart:async';
import 'dart:typed_data';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Lifecycle state of a [WebSocketTransport].
enum TransportState {
  /// No connection.
  disconnected,

  /// Opening the connection.
  connecting,

  /// Connected and ready to send/receive.
  connected,

  /// Closing the connection.
  closing,
}

/// Abstraction over a bidirectional binary WebSocket channel.
///
/// Defined in `architecture/02a-system-architecture.md` (section 5.3.1).
/// Implemented for production by [WebSocketChannelTransport]; tests use an
/// in-memory double. Frames are raw bytes (handshake JSON or E2EE envelopes).
abstract class WebSocketTransport {
  /// Opens a connection to [url] with optional upgrade [headers].
  Future<void> connect(String url, {Map<String, String>? headers});

  /// Closes the connection.
  Future<void> disconnect();

  /// Sends a binary frame.
  Future<void> send(Uint8List data);

  /// Inbound binary frames.
  Stream<Uint8List> get incoming;

  /// Connection state transitions.
  Stream<TransportState> get stateChanges;
}

/// `web_socket_channel`-backed [WebSocketTransport] for Android and iOS.
///
/// Uses [IOWebSocketChannel] so custom upgrade headers (the relay's
/// `x-role: iphone` / `x-session-id`) are honored — these are required to route
/// the session on the relay (spec 02a §5.10.1).
class WebSocketChannelTransport implements WebSocketTransport {
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  final StreamController<Uint8List> _incoming =
      StreamController<Uint8List>.broadcast();
  final StreamController<TransportState> _state =
      StreamController<TransportState>.broadcast();

  @override
  Stream<Uint8List> get incoming => _incoming.stream;

  @override
  Stream<TransportState> get stateChanges => _state.stream;

  @override
  Future<void> connect(String url, {Map<String, String>? headers}) async {
    _state.add(TransportState.connecting);
    final channel = IOWebSocketChannel.connect(
      Uri.parse(url),
      headers: headers,
      // Heartbeat: the underlying socket auto-pings and closes if no pong
      // arrives, so a dropped phone↔relay link is detected (and reconnection is
      // triggered) instead of lingering as a half-open "connected" socket.
      pingInterval: const Duration(seconds: 20),
    );
    _channel = channel;
    await channel.ready;
    _subscription = channel.stream.listen(
      (dynamic data) => _incoming.add(_asBytes(data)),
      onDone: () => _state.add(TransportState.disconnected),
      onError: _incoming.addError,
    );
    _state.add(TransportState.connected);
  }

  @override
  Future<void> send(Uint8List data) async {
    final channel = _channel;
    if (channel == null) {
      throw StateError('WebSocketChannelTransport.send before connect');
    }
    channel.sink.add(data);
  }

  @override
  Future<void> disconnect() async {
    _state.add(TransportState.closing);
    await _subscription?.cancel();
    await _channel?.sink.close();
    _channel = null;
    _state.add(TransportState.disconnected);
  }

  static Uint8List _asBytes(dynamic data) {
    if (data is Uint8List) return data;
    if (data is List<int>) return Uint8List.fromList(data);
    if (data is String) return Uint8List.fromList(data.codeUnits);
    throw ArgumentError(
      'Unsupported WebSocket frame type: ${data.runtimeType}',
    );
  }
}
