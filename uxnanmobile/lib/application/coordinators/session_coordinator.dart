import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:rxdart/rxdart.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/connection_recovery_state.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/secure_envelope.dart';
import 'package:uxnan/infrastructure/transport/backoff_calculator.dart';
import 'package:uxnan/infrastructure/transport/outbound_message_buffer.dart';
import 'package:uxnan/infrastructure/transport/request_correlator.dart';
import 'package:uxnan/infrastructure/transport/secure_transport_layer.dart';
import 'package:uxnan/infrastructure/transport/transport_selector.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// Resolves the phone's permanent identity (typically from secure storage).
typedef PhoneIdentityResolver = Future<PhoneIdentity> Function();

/// Awaits [duration]; injectable so tests can elide real backoff delays.
typedef DelayFn = Future<void> Function(Duration duration);

/// Orchestrates the secure session lifecycle: connect, encrypted RPC, automatic
/// reconnection and catch-up.
///
/// Application-layer coordinator (spec 02a §5.2.1). Connection state is exposed
/// as streams so the presentation layer can bridge it through Riverpod
/// `StreamProvider`s. Reconnection uses exponential backoff up to a maximum
/// number of attempts before requiring manual intervention (spec 02c §11).
class SessionCoordinator {
  /// Creates a [SessionCoordinator].
  SessionCoordinator({
    required SecureTransportLayer secureTransport,
    required TransportSelector transportSelector,
    required PhoneIdentityResolver identityResolver,
    RequestCorrelator? correlator,
    BackoffCalculator? backoff,
    OutboundMessageBuffer? outboundBuffer,
    Uuid? uuid,
    DelayFn? delay,
    int maxReconnectAttempts = 10,
  })  : _secureTransport = secureTransport,
        _transportSelector = transportSelector,
        _identityResolver = identityResolver,
        _correlator = correlator ?? RequestCorrelator(),
        _backoff = backoff ?? BackoffCalculator(),
        _outboundBuffer = outboundBuffer ?? OutboundMessageBuffer(),
        _uuid = uuid ?? const Uuid(),
        _delay = delay ?? Future<void>.delayed,
        _maxReconnectAttempts = maxReconnectAttempts;

  final SecureTransportLayer _secureTransport;
  final TransportSelector _transportSelector;
  final PhoneIdentityResolver _identityResolver;
  final RequestCorrelator _correlator;
  final BackoffCalculator _backoff;
  final OutboundMessageBuffer _outboundBuffer;
  final Uuid _uuid;
  final DelayFn _delay;
  final int _maxReconnectAttempts;

  final BehaviorSubject<ConnectionPhase> _connectionPhase =
      BehaviorSubject<ConnectionPhase>.seeded(ConnectionPhase.disconnected);
  final BehaviorSubject<ConnectionRecoveryState> _recoveryState =
      BehaviorSubject<ConnectionRecoveryState>.seeded(
    const ConnectionRecoveryState(),
  );
  final BehaviorSubject<TrustedDevice?> _activeMac =
      BehaviorSubject<TrustedDevice?>.seeded(null);
  final StreamController<RpcMessage> _incoming =
      StreamController<RpcMessage>.broadcast();

  WebSocketTransport? _transport;
  SecureChannel? _channel;
  StreamSubscription<Uint8List>? _rxSubscription;
  bool _intentionalDisconnect = false;
  bool _disposed = false;

  /// Stream of connection phase transitions (current value replayed on listen).
  Stream<ConnectionPhase> get connectionPhaseStream => _connectionPhase.stream;

  /// Current connection phase.
  ConnectionPhase get connectionPhase => _connectionPhase.value;

  /// Stream of reconnection recovery state.
  Stream<ConnectionRecoveryState> get recoveryStateStream =>
      _recoveryState.stream;

  /// Stream of the active bridge device.
  Stream<TrustedDevice?> get activeMacStream => _activeMac.stream;

  /// The currently active bridge device, if any.
  TrustedDevice? get activeMac => _activeMac.value;

  /// Stream of inbound requests and notifications from the bridge (responses
  /// are routed to their pending [sendRequest] futures instead).
  Stream<RpcMessage> get incomingMessages => _incoming.stream;

  /// Sets the active bridge device (used by the pairing flow).
  void setActiveDevice(TrustedDevice device) => _activeMac.add(device);

  /// Connects to the active device. Uses trusted reconnect unless
  /// [forceQrBootstrap] is set (first pairing).
  Future<void> connect({bool forceQrBootstrap = false}) async {
    final device = _activeMac.value;
    if (device == null) {
      throw StateError('SessionCoordinator.connect: no active device');
    }
    _intentionalDisconnect = false;
    await _establish(
      device,
      forceQrBootstrap
          ? HandshakeMode.qrBootstrap
          : HandshakeMode.trustedReconnect,
    );
  }

  /// Switches to a different trusted device, reconnecting.
  Future<void> switchMac(TrustedDevice device) async {
    await disconnect();
    setActiveDevice(device);
    await connect();
  }

  /// Sends a JSON-RPC request and resolves with the bridge's response.
  ///
  /// When connected the request is encrypted and sent immediately; otherwise it
  /// is buffered and flushed on the next successful (re)connection.
  Future<RpcMessage> sendRequest(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    final id = _uuid.v4();
    final request = RpcMessage.request(id: id, method: method, params: params);
    final future = _correlator.register(id);
    if (_connectionPhase.value == ConnectionPhase.connected &&
        _channel != null) {
      unawaited(_sendEncrypted(request));
    } else {
      _outboundBuffer.enqueue(request);
    }
    return future;
  }

  /// Tears down the session deliberately (no reconnection is attempted).
  Future<void> disconnect() async {
    _intentionalDisconnect = true;
    await _rxSubscription?.cancel();
    _rxSubscription = null;
    await _transport?.disconnect();
    _transport = null;
    _channel = null;
    _correlator.rejectAll(
      const TransportException(
        TransportErrorKind.connection,
        'Session disconnected',
      ),
    );
    if (!_disposed) _connectionPhase.add(ConnectionPhase.disconnected);
  }

  /// Runs the reconnection loop with exponential backoff.
  Future<void> handleReconnect() async {
    final device = _activeMac.value;
    if (device == null || _intentionalDisconnect || _disposed) return;

    _connectionPhase.add(ConnectionPhase.reconnecting);
    await _rxSubscription?.cancel();
    _rxSubscription = null;

    for (var attempt = 1; attempt <= _maxReconnectAttempts; attempt++) {
      final wait = _backoff.compute(attempt);
      _recoveryState.add(
        ConnectionRecoveryState(
          isRecovering: true,
          attempt: attempt,
          maxAttempts: _maxReconnectAttempts,
          nextRetryIn: wait,
          lastConnectedAt: _recoveryState.value.lastConnectedAt,
        ),
      );
      await _delay(wait);
      if (_intentionalDisconnect || _disposed) return;
      try {
        await _establish(device, HandshakeMode.trustedReconnect);
        return;
      } on Object catch (error) {
        _recoveryState.add(
          _recoveryState.value.copyWith(lastErrorMessage: error.toString()),
        );
      }
    }

    _connectionPhase.add(ConnectionPhase.error);
    _recoveryState.add(
      _recoveryState.value.copyWith(
        isRecovering: false,
        requiresManualIntervention: true,
      ),
    );
    _correlator.rejectAll(
      const TransportException(
        TransportErrorKind.connection,
        'Reconnection attempts exhausted',
      ),
    );
  }

  /// Releases all resources. The coordinator is unusable afterwards.
  Future<void> dispose() async {
    _disposed = true;
    _intentionalDisconnect = true;
    await _rxSubscription?.cancel();
    await _transport?.disconnect();
    await _connectionPhase.close();
    await _recoveryState.close();
    await _activeMac.close();
    await _incoming.close();
  }

  Future<void> _establish(TrustedDevice device, HandshakeMode mode) async {
    _connectionPhase.add(ConnectionPhase.connecting);
    final transport = await _transportSelector.select(device);
    try {
      _transport = transport;
      _connectionPhase.add(ConnectionPhase.handshaking);
      final identity = await _identityResolver();
      final session = await _secureTransport.performHandshake(
        transport: transport,
        phoneIdentity: identity,
        device: device,
        mode: mode,
      );
      _channel = _secureTransport.openChannel(session);
      _connectionPhase.add(ConnectionPhase.syncing);
      _startReceiving(transport);
      await _flushOutbound();
      _connectionPhase.add(ConnectionPhase.connected);
      _recoveryState.add(
        ConnectionRecoveryState(lastConnectedAt: DateTime.now()),
      );
    } on Object {
      await transport.disconnect().catchError((_) {});
      if (identical(_transport, transport)) {
        _transport = null;
        _channel = null;
      }
      rethrow;
    }
  }

  void _startReceiving(WebSocketTransport transport) {
    _rxSubscription = transport.incoming.listen(
      _handleRaw,
      onDone: _handleClosed,
      onError: (Object _, StackTrace __) => _handleClosed(),
    );
  }

  Future<void> _handleRaw(Uint8List raw) async {
    final channel = _channel;
    if (channel == null) return;
    if (_secureTransport.classifyRaw(raw) != SecureMessageKind.envelope) return;
    try {
      final envelope = SecureEnvelope.fromJson(
        jsonDecode(utf8.decode(raw)) as Map<String, dynamic>,
      );
      final plaintext = await channel.decrypt(envelope);
      final message = RpcMessage.fromJson(
        jsonDecode(utf8.decode(plaintext)) as Map<String, dynamic>,
      );
      if (message.isResponse) {
        _correlator.resolve(message);
      } else {
        _incoming.add(message);
      }
    } on TransportException catch (error) {
      AppLogger.warn('Dropping inbound frame: ${error.message}');
    }
  }

  void _handleClosed() {
    if (_intentionalDisconnect ||
        _disposed ||
        _connectionPhase.value == ConnectionPhase.reconnecting) {
      return;
    }
    unawaited(handleReconnect());
  }

  Future<void> _flushOutbound() async {
    for (final pending in _outboundBuffer.drainAll()) {
      await _sendEncrypted(pending.message);
    }
  }

  Future<void> _sendEncrypted(RpcMessage message) async {
    final channel = _channel;
    final transport = _transport;
    if (channel == null || transport == null) {
      _outboundBuffer.enqueue(message);
      return;
    }
    final plaintext = Uint8List.fromList(
      utf8.encode(jsonEncode(message.toJson())),
    );
    final envelope = await channel.encrypt(plaintext);
    await transport.send(
      Uint8List.fromList(utf8.encode(jsonEncode(envelope.toJson()))),
    );
  }
}
