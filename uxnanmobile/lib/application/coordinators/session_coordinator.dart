import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:rxdart/rxdart.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/connection_recovery_state.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';
import 'package:uxnan/domain/repositories/i_trusted_device_repository.dart';
import 'package:uxnan/domain/services/pairing_validator.dart';
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
    ITrustedDeviceRepository? trustedDeviceRepository,
    PairingValidator pairingValidator = const PairingValidator(),
    RequestCorrelator? correlator,
    BackoffCalculator? backoff,
    OutboundMessageBuffer? outboundBuffer,
    Uuid? uuid,
    DelayFn? delay,
    int maxReconnectAttempts = 10,
  })  : _secureTransport = secureTransport,
        _transportSelector = transportSelector,
        _identityResolver = identityResolver,
        _trustedDeviceRepository = trustedDeviceRepository,
        _pairingValidator = pairingValidator,
        _correlator = correlator ?? RequestCorrelator(),
        _backoff = backoff ?? BackoffCalculator(),
        _outboundBuffer = outboundBuffer ?? OutboundMessageBuffer(),
        _uuid = uuid ?? const Uuid(),
        _delay = delay ?? Future<void>.delayed,
        _maxReconnectAttempts = maxReconnectAttempts;

  final SecureTransportLayer _secureTransport;
  final TransportSelector _transportSelector;
  final PhoneIdentityResolver _identityResolver;
  final ITrustedDeviceRepository? _trustedDeviceRepository;
  final PairingValidator _pairingValidator;
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
  // The device with a LIVE encrypted channel right now. Distinct from
  // `_activeMac` (the device the user is browsing/selected): browsing a PC must
  // not make it look connected. The connection indicators key off this.
  final BehaviorSubject<TrustedDevice?> _connectedDevice =
      BehaviorSubject<TrustedDevice?>.seeded(null);
  // The device a connection attempt is currently in flight for (so only that
  // PC shows "connecting", never the others).
  final BehaviorSubject<TrustedDevice?> _connectingDevice =
      BehaviorSubject<TrustedDevice?>.seeded(null);
  final StreamController<RpcMessage> _incoming =
      StreamController<RpcMessage>.broadcast();

  WebSocketTransport? _transport;
  SecureChannel? _channel;
  StreamSubscription<Uint8List>? _rxSubscription;
  bool _intentionalDisconnect = false;
  bool _disposed = false;
  bool _reconnecting = false;
  // Set while a post-resume liveness probe is in flight. The socket can be
  // silently half-open after the OS suspends the app in the background, yet the
  // phase still reads "connected". While this is true, new user requests are
  // held in the replay buffer instead of being written to a possibly-dead
  // socket (where they'd be lost): they flush once the probe confirms the link,
  // or replay after the reconnect a failed probe triggers. The probe itself
  // bypasses the hold (see [_probeBridgeStatus]).
  bool _verifyingAfterResume = false;

  /// Completed to interrupt the current reconnect backoff so a foreground
  /// [resume] retries immediately instead of waiting out the delay. `null` when
  /// the reconnect loop is not currently sleeping between attempts.
  Completer<void>? _reconnectWake;

  /// End-to-end liveness probe: while connected, periodically round-trips
  /// `bridge/status` so a dead bridge (even behind a still-open relay socket) is
  /// detected and reconnection is triggered. The transport-level close alone is
  /// not reliable when the relay stays up.
  Timer? _heartbeat;
  static const Duration _heartbeatInterval = Duration(seconds: 25);

  /// Serializes outbound encrypt+send so envelopes get strictly increasing,
  /// non-duplicated sequence numbers AND are transmitted in that order. Without
  /// this, two concurrent `sendRequest` calls would race on the channel's seq
  /// counter and the bridge would reject the later envelope(s) as replays.
  Future<void> _sendChain = Future<void>.value();

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

  /// Stream of the device that currently has a live channel (or null).
  Stream<TrustedDevice?> get connectedDeviceStream => _connectedDevice.stream;

  /// The device that currently has a live channel, if any.
  TrustedDevice? get connectedDevice => _connectedDevice.value;

  /// Stream of the device a connection attempt is in flight for (or null).
  Stream<TrustedDevice?> get connectingDeviceStream => _connectingDevice.stream;

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

  /// Switches the live session to a different trusted device, **validating
  /// reachability first**. The current session is kept intact and is only torn
  /// down once the target completes its handshake — so tapping an unreachable
  /// PC never flips it to "connected"; it stays on the current PC and the
  /// attempt surfaces as an error. Throws if the target can't be reached.
  Future<void> switchMac(TrustedDevice device) async {
    if (_connectedDevice.value?.macDeviceId == device.macDeviceId &&
        _connectionPhase.value == ConnectionPhase.connected) {
      return; // already the live device
    }
    _intentionalDisconnect = false;
    _connectingDevice.add(device);
    try {
      final session = await _openSession(
        device,
        HandshakeMode.trustedReconnect,
      );
      await _commitSession(device, session);
    } on Object {
      _connectingDevice.add(null);
      rethrow;
    }
  }

  /// Registers a scanned [payload] as a trusted device and starts the QR
  /// bootstrap handshake.
  ///
  /// Re-validates the payload defensively, persists the resulting
  /// [TrustedDevice], makes it active and connects with QR bootstrap. Requires
  /// a trusted-device repository to have been provided.
  Future<void> processPairingPayload(PairingPayload payload) async {
    final repository = _trustedDeviceRepository;
    if (repository == null) {
      throw StateError(
        'processPairingPayload requires a trusted device repository',
      );
    }
    final result = _pairingValidator.validatePayload(payload);
    if (!result.isValid) {
      throw TransportException(
        TransportErrorKind.handshake,
        'Invalid pairing payload: ${result.status.name}',
      );
    }
    final device = TrustedDevice(
      macDeviceId: payload.macDeviceId,
      displayName: payload.displayName,
      macIdentityPublicKey: payload.macIdentityPublicKey,
      relayUrl: payload.relayUrl,
      hosts: payload.hosts,
      sessionId: payload.sessionId,
      pairedAt: DateTime.now(),
    );
    await repository.saveDevice(device);
    setActiveDevice(device);
    await connect(forceQrBootstrap: true);
  }

  /// Cancels an in-progress pairing by tearing down the connection.
  Future<void> cancelPairing() => disconnect();

  /// Sends a JSON-RPC request and resolves with the bridge's response.
  ///
  /// When connected the request is encrypted and sent immediately; otherwise it
  /// is buffered and flushed on the next successful (re)connection. While a
  /// post-resume liveness probe is in flight ([_verifyingAfterResume]) the
  /// request is held in the buffer rather than risk a write to a half-open
  /// socket.
  Future<RpcMessage> sendRequest(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    final id = _uuid.v4();
    final request = RpcMessage.request(id: id, method: method, params: params);
    final future = _correlator.register(id);
    if (_verifyingAfterResume) {
      _outboundBuffer.enqueue(request);
    } else {
      _dispatch(request);
    }
    return future;
  }

  /// Sends [request] now if the channel is up, otherwise buffers it for the
  /// next (re)connection. Shared by [sendRequest] and the resume probe.
  void _dispatch(RpcMessage request) {
    if (_connectionPhase.value == ConnectionPhase.connected &&
        _channel != null) {
      unawaited(_sendEncrypted(request));
    } else {
      _outboundBuffer.enqueue(request);
    }
  }

  /// Actively checks the bridge is reachable with an encrypted `bridge/status`
  /// round-trip. If we believed we were connected but it times out (a dead
  /// bridge behind a still-open socket), the session is dropped so the
  /// reconnection loop takes over. Returns `true` if the bridge responded.
  Future<bool> verifyConnection({
    Duration timeout = const Duration(seconds: 6),
  }) async {
    final disconnected = _connectionPhase.value != ConnectionPhase.connected;
    if (disconnected || _channel == null) {
      // Not connected: kick a reconnect attempt instead of doing nothing, so
      // the action also serves as a manual "try to reconnect now".
      if (!_intentionalDisconnect && _activeMac.value != null) {
        unawaited(handleReconnect());
      }
      return false;
    }
    try {
      await _probeBridgeStatus(timeout);
      return true;
    } on Object {
      await _dropAndReconnect();
      return false;
    }
  }

  /// Round-trips `bridge/status`, bypassing the post-resume send hold so the
  /// probe itself is never buffered (it's what decides whether the link is
  /// alive). Mirrors [sendRequest]'s correlation but always dispatches now.
  Future<RpcMessage> _probeBridgeStatus(Duration timeout) {
    final id = _uuid.v4();
    final request = RpcMessage.request(id: id, method: 'bridge/status');
    final future = _correlator.register(id);
    _dispatch(request);
    return future.timeout(timeout);
  }

  void _startHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = Timer.periodic(_heartbeatInterval, (_) {
      unawaited(_heartbeatTick());
    });
  }

  void _stopHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = null;
  }

  Future<void> _heartbeatTick() async {
    final notConnected = _connectionPhase.value != ConnectionPhase.connected;
    if (notConnected || _channel == null) {
      return;
    }
    try {
      await sendRequest('bridge/status').timeout(const Duration(seconds: 8));
      // Checkpoint the applied seq periodically so a hard app-kill mid-session
      // still resumes from a recent point (not just from the last disconnect).
      _persistBridgeSeq();
    } on Object {
      await _dropAndReconnect();
    }
  }

  /// Persists the highest bridge→phone `seq` applied on the live channel so a
  /// later reconnect can advertise it (`clientHello.resumeState`) and the
  /// bridge replays only what was missed (spec 02a §5.9.2). Best-effort: it
  /// updates the in-memory active device synchronously so an immediate
  /// reconnect reads the fresh value, then persists asynchronously. No-op when
  /// nothing advanced.
  void _persistBridgeSeq() {
    final repo = _trustedDeviceRepository;
    final channel = _channel;
    if (repo == null || channel == null) return;
    final seq = channel.session.bridgeOutboundSeq;
    final macId = channel.session.macDeviceId;
    final active = _activeMac.value;
    if (active != null && active.macDeviceId == macId) {
      if (seq <= active.lastAppliedBridgeOutboundSeq) return;
      final updated = active.copyWith(lastAppliedBridgeOutboundSeq: seq);
      _activeMac.add(updated);
      unawaited(repo.saveDevice(updated));
    } else {
      // The connected device is not the active one (e.g. browsing another PC):
      // update its persisted record directly without touching `_activeMac`.
      unawaited(_persistSeqForDevice(repo, macId, seq));
    }
  }

  Future<void> _persistSeqForDevice(
    ITrustedDeviceRepository repo,
    String macId,
    int seq,
  ) async {
    final device = await repo.getDevice(macId);
    if (device == null || seq <= device.lastAppliedBridgeOutboundSeq) return;
    await repo.saveDevice(
      device.copyWith(lastAppliedBridgeOutboundSeq: seq),
    );
  }

  /// Records "last seen = now" for [device] so the PC card reflects the real
  /// last connection instead of "never connected".
  void _touchLastSeen(TrustedDevice device) {
    final repo = _trustedDeviceRepository;
    if (repo == null) return;
    final updated = device.copyWith(lastSeen: DateTime.now());
    _activeMac.add(updated);
    unawaited(repo.saveDevice(updated));
  }

  /// Drops the (apparently dead) session and starts the reconnection loop.
  Future<void> _dropAndReconnect() async {
    _persistBridgeSeq();
    _stopHeartbeat();
    await _rxSubscription?.cancel();
    _rxSubscription = null;
    await _transport?.disconnect().catchError((_) {});
    _transport = null;
    _channel = null;
    _connectedDevice.add(null);
    unawaited(handleReconnect());
  }

  /// Tears down the session deliberately (no reconnection is attempted).
  Future<void> disconnect() async {
    _intentionalDisconnect = true;
    _persistBridgeSeq();
    _stopHeartbeat();
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
    if (!_disposed) {
      _connectedDevice.add(null);
      _connectingDevice.add(null);
      _connectionPhase.add(ConnectionPhase.disconnected);
    }
  }

  /// Tells [device]'s bridge to revoke THIS phone's trust (so it can no longer
  /// trusted-reconnect) and tears down the session when [device] is the
  /// connected one. The bridge is only reachable while we hold that device's
  /// live channel, so this only sends the RPC when connected here; otherwise it
  /// is a no-op on the wire and the caller still removes the device locally
  /// (clearing a stale PC). Best-effort: a failed/Unsupported call is logged,
  /// never thrown, so local removal always proceeds.
  Future<void> removeTrustedDevice(TrustedDevice device) async {
    if (connectedDevice?.macDeviceId != device.macDeviceId) return;
    try {
      final identity = await _identityResolver();
      await sendRequest(
        'bridge/removeTrustedDevice',
        {'deviceId': identity.phoneDeviceId},
      ).timeout(const Duration(seconds: 5));
    } on Object catch (error, stackTrace) {
      AppLogger.warn(
        'bridge/removeTrustedDevice failed (removed locally)',
        error,
        stackTrace,
      );
    }
    await disconnect();
  }

  /// Runs the reconnection loop with exponential backoff. Single-flight: a
  /// second caller (heartbeat, verify, socket close) while a loop is already
  /// running is a no-op, so overlapping attempts can't sabotage each other's
  /// handshakes.
  Future<void> handleReconnect() async {
    final device = _activeMac.value;
    if (device == null || _intentionalDisconnect || _disposed) return;
    if (_reconnecting) return;
    _reconnecting = true;
    _stopHeartbeat();
    try {
      await _runReconnectLoop(device);
    } finally {
      _reconnecting = false;
    }
  }

  /// Call when the app returns to the foreground (resume): ensures the bridge
  /// connection is healthy after the OS may have suspended/dropped the socket
  /// while backgrounded.
  ///
  /// - **Mid-reconnect**: interrupts the backoff so the next attempt runs *now*
  ///   instead of after the (possibly long) delay — the user gets reconnected
  ///   promptly on reopen.
  /// - **Believed-connected**: holds new user sends, round-trips `bridge/status`
  ///   (via [verifyConnection]) to catch a silently-dropped socket, then either
  ///   flushes the held sends (link confirmed) or lets the reconnect replay
  ///   them (link dead) — so a message typed right after reopening is never
  ///   written to a half-open socket and lost.
  /// - **Disconnected with an active device**: kicks a reconnect.
  ///
  /// No-op after an intentional disconnect or once disposed.
  Future<void> resume() async {
    if (_intentionalDisconnect || _disposed || _activeMac.value == null) return;
    if (_reconnecting) {
      _wakeReconnect();
      return;
    }
    // Hold user traffic until the probe confirms the socket is actually alive.
    _verifyingAfterResume = true;
    try {
      final alive = await verifyConnection();
      _verifyingAfterResume = false;
      // Link confirmed: send anything the user queued during the probe. If it
      // wasn't alive, verifyConnection already kicked the reconnect, whose
      // successful (re)connection flushes the buffer instead.
      if (alive) await _flushOutbound();
    } finally {
      _verifyingAfterResume = false;
    }
  }

  /// Waits out the reconnect backoff [wait], returning early when
  /// [_wakeReconnect] fires (e.g. the app resumed) so the next attempt is
  /// immediate. The [_delay] keeps running in the background harmlessly.
  Future<void> _waitForRetry(Duration wait) async {
    final wake = Completer<void>();
    _reconnectWake = wake;
    try {
      await Future.any<void>([_delay(wait), wake.future]);
    } finally {
      _reconnectWake = null;
    }
  }

  /// Interrupts the current reconnect backoff so the next attempt runs now.
  void _wakeReconnect() {
    final wake = _reconnectWake;
    if (wake != null && !wake.isCompleted) wake.complete();
  }

  Future<void> _runReconnectLoop(TrustedDevice device) async {
    _connectionPhase.add(ConnectionPhase.reconnecting);
    _connectedDevice.add(null);
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
      await _waitForRetry(wait);
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
    _stopHeartbeat();
    _intentionalDisconnect = true;
    await _rxSubscription?.cancel();
    await _transport?.disconnect();
    await _connectionPhase.close();
    await _recoveryState.close();
    await _activeMac.close();
    await _connectedDevice.close();
    await _connectingDevice.close();
    await _incoming.close();
  }

  /// Connect/reconnect path: drives the global phase (`connecting`), opens a
  /// session and commits it. On failure the global phase is left for the caller
  /// (reconnect loop) or the error handler to resolve.
  Future<void> _establish(TrustedDevice device, HandshakeMode mode) async {
    _connectionPhase.add(ConnectionPhase.connecting);
    _connectingDevice.add(device);
    try {
      _connectionPhase.add(ConnectionPhase.handshaking);
      final session = await _openSession(device, mode);
      await _commitSession(device, session);
    } on Object {
      _connectingDevice.add(null);
      rethrow;
    }
  }

  /// Opens a transport + secure channel for [device] into locals, with NO side
  /// effects on the current session/phase — so a failed attempt (e.g. an
  /// unreachable device during a switch) leaves any existing session untouched.
  Future<(WebSocketTransport, SecureChannel)> _openSession(
    TrustedDevice device,
    HandshakeMode mode,
  ) async {
    final transport = await _transportSelector.select(device);
    try {
      final identity = await _identityResolver();
      final session = await _secureTransport.performHandshake(
        transport: transport,
        phoneIdentity: identity,
        device: device,
        mode: mode,
        // Advertise the last applied bridge→phone seq so the bridge replays the
        // outbound we missed (spec 02a §5.9.2). 0 on first pairing.
        lastAppliedBridgeOutboundSeq: device.lastAppliedBridgeOutboundSeq,
      );
      final channel = _secureTransport.openChannel(session);
      return (transport, channel);
    } on Object {
      await transport.disconnect().catchError((_) {});
      rethrow;
    }
  }

  /// Commits a freshly-opened [session] as the live one: tears down the
  /// previous transport, swaps in the new channel, flushes buffered requests
  /// and marks the phase connected. Used by the connect path and a validated
  /// switch.
  Future<void> _commitSession(
    TrustedDevice device,
    (WebSocketTransport, SecureChannel) session,
  ) async {
    final (transport, channel) = session;
    _stopHeartbeat();
    await _rxSubscription?.cancel();
    _rxSubscription = null;
    final previous = _transport;
    _transport = transport;
    _channel = channel;
    if (previous != null && !identical(previous, transport)) {
      await previous.disconnect().catchError((_) {});
    }
    _connectionPhase.add(ConnectionPhase.syncing);
    _startReceiving(transport);
    await _flushOutbound();
    _connectedDevice.add(device);
    _connectingDevice.add(null);
    _connectionPhase.add(ConnectionPhase.connected);
    _startHeartbeat();
    _touchLastSeen(device);
    _recoveryState.add(
      ConnectionRecoveryState(lastConnectedAt: DateTime.now()),
    );
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
    // Persist (sync part updates `_activeMac`) BEFORE the reconnect captures
    // the active device, so the reconnect advertises the freshest applied seq.
    _persistBridgeSeq();
    unawaited(handleReconnect());
  }

  Future<void> _flushOutbound() async {
    for (final pending in _outboundBuffer.drainAll()) {
      await _sendEncrypted(pending.message);
    }
  }

  /// Enqueues an encrypt+send onto the serialized [_sendChain] so messages are
  /// assigned sequence numbers and transmitted strictly in order.
  Future<void> _sendEncrypted(RpcMessage message) {
    return _sendChain =
        _sendChain.then((_) => _encryptAndSend(message)).catchError(
      (Object error, StackTrace _) {
        AppLogger.warn('Failed to send "${message.method}": $error');
      },
    );
  }

  Future<void> _encryptAndSend(RpcMessage message) async {
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
