import 'dart:async';
import 'dart:convert';
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
/// in-memory double. Frames are raw bytes (handshake JSON or E2EE envelopes);
/// a text frame arrives as its UTF-8 bytes.
abstract class WebSocketTransport {
  /// Opens a connection to [url].
  Future<void> connect(String url);

  /// Closes the connection.
  Future<void> disconnect();

  /// Sends a binary frame.
  Future<void> send(Uint8List data);

  /// Sends a text frame. Only the relay's control frames need one (the relay
  /// reads its auth frame as text, `relay/src/room.ts`); everything past them
  /// travels through [send].
  Future<void> sendText(String text);

  /// Inbound frames, binary or text, as bytes.
  Stream<Uint8List> get incoming;

  /// The close code the peer sent, once [incoming] is done; null before, or
  /// when the connection dropped without one. The relay explains why it
  /// refused a phone with these (`RELAY_CLOSE`, 4001–4011).
  int? get closeCode;

  /// Connection state transitions.
  Stream<TransportState> get stateChanges;

  /// The URL the live connection is served through (as passed to [connect]), or
  /// null when not connected. Lets callers surface the endpoint actually in use
  /// — which direct LAN/Tailscale host won the dial race, or the relay — rather
  /// than a statically-guessed "first advertised host".
  String? get connectedUrl;
}

/// `web_socket_channel`-backed [WebSocketTransport] for Android and iOS, used
/// for direct LAN/Tailscale hosts and for the relay alike (the relay routes by
/// URL path, `/v1/connect/<routingId>`; no custom headers).
class WebSocketChannelTransport implements WebSocketTransport {
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  late StreamController<Uint8List> _incoming = _newIncoming();

  /// Frames that arrived while nobody listened to [incoming], kept for its
  /// next listener. The relay sends its challenge the moment the socket
  /// opens, before the caller of [connect] has had a chance to listen; a
  /// broadcast stream would drop it.
  final List<Uint8List> _unheard = [];

  /// The socket ended while [_unheard] still held frames: [incoming] closes
  /// once its next listener has them.
  bool _endedUnheard = false;
  final StreamController<TransportState> _state =
      StreamController<TransportState>.broadcast();
  String? _connectedUrl;
  int? _closeCode;

  @override
  Stream<Uint8List> get incoming => _incoming.stream;

  @override
  int? get closeCode => _closeCode;

  @override
  Stream<TransportState> get stateChanges => _state.stream;

  @override
  String? get connectedUrl => _connectedUrl;

  @override
  Future<void> connect(String url) async {
    // Fresh stream controller so old listeners (e.g. a handshake StreamQueue
    // from a previous attempt) fail fast instead of hanging forever.
    _resetIncoming();
    _closeCode = null;
    _state.add(TransportState.connecting);
    final channel = IOWebSocketChannel.connect(
      Uri.parse(url),
      // Heartbeat: the underlying socket sends WebSocket protocol pings and
      // closes if no pong arrives, so a dropped link is detected (and
      // reconnection is triggered) instead of lingering as a half-open
      // "connected" socket. Protocol pings, never the relay's `ping` text
      // frame: those are answered by the runtime on both the bridge and the
      // relay, and nothing but E2EE frames ever reaches the secure layer.
      pingInterval: const Duration(seconds: 20),
    );
    _channel = channel;
    await channel.ready;
    _subscription = channel.stream.listen(
      (dynamic data) => _deliver(_asBytes(data)),
      onDone: () {
        _closeCode = channel.closeCode;
        _state.add(TransportState.disconnected);
        // End the data stream so any in-flight StreamQueue.next() in
        // performHandshake rejects instead of hanging forever when the remote
        // drops the connection mid-handshake.
        _endIncoming();
      },
      onError: (Object error) => _incoming.addError(error),
    );
    // Record the endpoint only once the channel is actually up, so a failed
    // attempt never leaves a stale "connected to" address behind.
    _connectedUrl = url;
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
  Future<void> sendText(String text) async {
    final channel = _channel;
    if (channel == null) {
      throw StateError('WebSocketChannelTransport.sendText before connect');
    }
    channel.sink.add(text);
  }

  @override
  Future<void> disconnect() async {
    _state.add(TransportState.closing);
    await _subscription?.cancel();
    await _channel?.sink.close();
    _channel = null;
    _connectedUrl = null;
    _unheard.clear();
    _endedUnheard = false;
    if (!_incoming.isClosed) unawaited(_incoming.close());
    _state.add(TransportState.disconnected);
  }

  /// Closes the current [_incoming] controller and creates a fresh one for a
  /// new connection, so old listeners (StreamQueue, coordinator subscription)
  /// terminate promptly.
  void _resetIncoming() {
    _unheard.clear();
    _endedUnheard = false;
    if (!_incoming.isClosed) unawaited(_incoming.close());
    _incoming = _newIncoming();
  }

  StreamController<Uint8List> _newIncoming() {
    final controller = StreamController<Uint8List>.broadcast();
    return controller..onListen = () => _flushUnheard(controller);
  }

  /// Hands the frames nobody heard to [controller]'s first listener (and
  /// ends it, if the socket ended meanwhile).
  void _flushUnheard(StreamController<Uint8List> controller) {
    if (!identical(controller, _incoming)) return;
    final unheard = List.of(_unheard);
    _unheard.clear();
    unheard.forEach(controller.add);
    if (_endedUnheard) {
      _endedUnheard = false;
      unawaited(controller.close());
    }
  }

  void _deliver(Uint8List frame) {
    if (_incoming.hasListener) {
      _incoming.add(frame);
    } else {
      _unheard.add(frame);
    }
  }

  void _endIncoming() {
    if (_incoming.isClosed) return;
    if (_unheard.isEmpty || _incoming.hasListener) {
      unawaited(_incoming.close());
    } else {
      _endedUnheard = true;
    }
  }

  static Uint8List _asBytes(dynamic data) {
    if (data is Uint8List) return data;
    if (data is List<int>) return Uint8List.fromList(data);
    if (data is String) return Uint8List.fromList(utf8.encode(data));
    throw ArgumentError(
      'Unsupported WebSocket frame type: ${data.runtimeType}',
    );
  }
}
