import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:rxdart/rxdart.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/connection_recovery_state.dart';
import 'package:uxnan/domain/entities/connection_session.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/connection_route.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';
import 'package:uxnan/domain/repositories/i_connection_session_repository.dart';
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
    IConnectionSessionRepository? connectionSessionRepository,
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
        _connectionSessionRepository = connectionSessionRepository,
        _pairingValidator = pairingValidator,
        _correlator = correlator ?? RequestCorrelator(),
        _backoff = backoff ?? BackoffCalculator(),
        _outboundBuffer = outboundBuffer ?? OutboundMessageBuffer(),
        _uuid = uuid ?? const Uuid(),
        _delay = delay ?? Future<void>.delayed,
        _maxReconnectAttempts = maxReconnectAttempts {
    // Close any session left open by a previous run (an app kill without a
    // clean disconnect) so its time is bounded at the last-known-alive moment.
    final repo = _connectionSessionRepository;
    if (repo != null) {
      unawaited(repo.closeDanglingSessions().catchError((_) {}));
    }
  }

  final SecureTransportLayer _secureTransport;
  final TransportSelector _transportSelector;
  final PhoneIdentityResolver _identityResolver;
  final ITrustedDeviceRepository? _trustedDeviceRepository;
  final IConnectionSessionRepository? _connectionSessionRepository;
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
  // The URL the live channel is actually served through — the direct
  // LAN/Tailscale host that won the dial race, or the relay. Distinct from the
  // device's advertised hosts (whose first entry is a lexicographic guess, not
  // the endpoint in use); the PC card reads this to show the real address.
  // Mirrors [_connectedDevice]'s lifecycle: set on commit, cleared on any
  // teardown/reconnect.
  final BehaviorSubject<String?> _connectedEndpoint =
      BehaviorSubject<String?>.seeded(null);
  // How the live channel reaches the PC — LAN, Tailscale or the relay —
  // classified ONCE, here, from [_connectedEndpoint] when a session commits.
  // Every surface (badges, metrics, hints) reads this instead of classifying
  // the endpoint again. Same lifecycle as [_connectedEndpoint].
  final BehaviorSubject<ConnectionRoute?> _connectedRoute =
      BehaviorSubject<ConnectionRoute?>.seeded(null);
  // The device a connection attempt is currently in flight for (so only that
  // PC shows "connecting", never the others).
  final BehaviorSubject<TrustedDevice?> _connectingDevice =
      BehaviorSubject<TrustedDevice?>.seeded(null);
  final StreamController<RpcMessage> _incoming =
      StreamController<RpcMessage>.broadcast();

  WebSocketTransport? _transport;
  SecureChannel? _channel;
  StreamSubscription<Uint8List>? _rxSubscription;
  // Log-row id for the LIVE connection session, or null when not connected.
  // Set on commit, cleared on teardown.
  String? _connectionSessionId;
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
  // Set while the session tries to leave the relay for a direct host
  // ([_tryDirectRoute]). The relay session stays the live one throughout; a
  // close of it is noted in [_closedDuringSwitch] instead of reconnecting —
  // the bridge closes it itself the moment the direct session registers.
  bool _switchingToDirect = false;
  WebSocketTransport? _closedDuringSwitch;
  // Set once a direct host answered and its handshake runs: new user requests
  // wait in the replay buffer so none is written to the relay connection the
  // bridge is about to close (its answer would be lost with it).
  bool _holdingForSwitch = false;

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

  /// Stream of the URL the live channel is served through (the winning direct
  /// host, or the relay), or null when not connected.
  Stream<String?> get connectedEndpointStream => _connectedEndpoint.stream;

  /// The URL the live channel is served through, if any.
  String? get connectedEndpoint => _connectedEndpoint.value;

  /// Stream of how the live channel reaches the PC (LAN, Tailscale or the
  /// relay), or null when not connected.
  Stream<ConnectionRoute?> get connectedRouteStream => _connectedRoute.stream;

  /// How the live channel reaches the PC, if connected.
  ConnectionRoute? get connectedRoute => _connectedRoute.value;

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
      final current = await _withStoredRelay(device);
      final session = await _openSession(
        current,
        HandshakeMode.trustedReconnect,
      );
      await _commitSession(current, session);
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
      relay: payload.relay,
      hosts: payload.hosts,
      sessionId: payload.sessionId,
      pairedAt: DateTime.now(),
    );
    await repository.saveDevice(device);
    setActiveDevice(device);
    _intentionalDisconnect = false;
    // The QR's one-time relay ticket lets a phone that is not on the PC's
    // network pair through the relay. It serves this first connection only:
    // once paired, the bridge trusts this phone's key on its relay, so the
    // ticket is never stored.
    await _establish(
      device,
      HandshakeMode.qrBootstrap,
      relayTicket: payload.relayTicket,
    );
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
  ///
  /// [timeout] replaces the correlator's default wait for a request the
  /// bridge answers only after slow outside work — deploying the relay to the
  /// user's Cloudflare account takes up to a minute.
  Future<RpcMessage> sendRequest(
    String method, [
    Map<String, dynamic>? params,
    Duration? timeout,
  ]) {
    final id = _uuid.v4();
    final request = RpcMessage.request(id: id, method: method, params: params);
    final future = _correlator.register(id, within: timeout);
    if (_verifyingAfterResume || _holdingForSwitch) {
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
      // Advance the connection-session log's last-active time so a force-kill
      // is bounded at the last-known-alive moment (not inflated).
      _touchConnectionSession();
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
      _activeMac.add(active.copyWith(lastAppliedBridgeOutboundSeq: seq));
    }
    // Only this field: the in-memory copy may be older than the stored record
    // (a rename lands in the store, not here), so it is never written back.
    unawaited(repo.recordBridgeOutboundSeq(macId, seq));
  }

  /// Opens a row in the phone-local connection-session log for the freshly
  /// committed session, so the metrics screens can report time connected,
  /// longest session, sessions count and the relay-vs-direct split. Best-effort
  /// and non-blocking; a no-op when no repository is wired (e.g. tests).
  void _startConnectionSession(
    TrustedDevice device,
    String? url,
    ConnectionRoute? route,
  ) {
    final repo = _connectionSessionRepository;
    if (repo == null) return;
    final now = DateTime.now();
    final id = _uuid.v4();
    _connectionSessionId = id;
    final isRelay = route == ConnectionRoute.relay;
    unawaited(
      repo
          .startSession(
            ConnectionSession(
              id: id,
              deviceId: device.macDeviceId,
              transport: isRelay
                  ? ConnectionTransport.relay
                  : ConnectionTransport.direct,
              endpoint: url,
              startedAt: now,
              lastActiveAt: now,
            ),
          )
          .catchError((_) {}),
    );
  }

  /// Advances the live session's last-active time (called from the heartbeat),
  /// so a later force-kill is closed at the last-known-alive moment.
  void _touchConnectionSession() {
    final repo = _connectionSessionRepository;
    final id = _connectionSessionId;
    if (repo == null || id == null) return;
    unawaited(repo.touchSession(id, DateTime.now()).catchError((_) {}));
  }

  /// Closes the live session's log row (a clean teardown). Idempotent: a second
  /// call after the id is cleared is a no-op.
  void _endConnectionSession() {
    final repo = _connectionSessionRepository;
    final id = _connectionSessionId;
    if (repo == null || id == null) return;
    _connectionSessionId = null;
    unawaited(repo.endSession(id, DateTime.now()).catchError((_) {}));
  }

  /// Records "last seen = now" for [device] so the PC card reflects the real
  /// last connection instead of "never connected".
  void _touchLastSeen(TrustedDevice device) {
    final repo = _trustedDeviceRepository;
    if (repo == null) return;
    final now = DateTime.now();
    _activeMac.add(device.copyWith(lastSeen: now));
    unawaited(repo.recordLastSeen(device.macDeviceId, now));
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
    _connectedEndpoint.add(null);
    _connectedRoute.add(null);
    _endConnectionSession();
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
      _connectedEndpoint.add(null);
      _connectedRoute.add(null);
      _endConnectionSession();
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
  /// - **Connected through the relay** (once the link is confirmed): tries the
  ///   PC's direct hosts once and moves there if one answers
  ///   ([_tryDirectRoute]) — the phone may have come home while it slept.
  ///
  /// No-op after an intentional disconnect or once disposed.
  Future<void> resume() => _resume(tryDirect: true);

  /// Call when the phone's network changed (it joined a Wi-Fi, left it for
  /// mobile data, …). The path the session holds may be gone, or a better one
  /// may have appeared:
  ///
  /// - **Connected through the relay**: dials the PC's direct hosts once
  ///   (bounded by the selector's per-host timeout) and moves the session
  ///   there if one answers — back home is back to direct, so the relay
  ///   carries only what has no other way. The relay session keeps working
  ///   until the direct one has completed its handshake, and stays if none
  ///   answers.
  /// - Otherwise — and when the relay session stays — it does what [resume]
  ///   does: confirms the link (a direct socket usually dies with its
  ///   network) or wakes a pending reconnect.
  Future<void> handleNetworkChange() async {
    if (_intentionalDisconnect || _disposed || _activeMac.value == null) {
      return;
    }
    if (await _tryDirectRoute()) return;
    await _resume(tryDirect: false);
  }

  Future<void> _resume({required bool tryDirect}) async {
    if (_intentionalDisconnect || _disposed || _activeMac.value == null) {
      return;
    }
    if (_reconnecting) {
      _wakeReconnect();
      return;
    }
    // Hold user traffic until the probe confirms the socket is actually alive.
    _verifyingAfterResume = true;
    var alive = false;
    try {
      alive = await verifyConnection();
      _verifyingAfterResume = false;
      // Link confirmed: send anything the user queued during the probe. If it
      // wasn't alive, verifyConnection already kicked the reconnect, whose
      // successful (re)connection flushes the buffer instead.
      if (alive) await _flushOutbound();
    } finally {
      _verifyingAfterResume = false;
    }
    if (alive && tryDirect) await _tryDirectRoute();
  }

  /// Moves a session held through the relay onto one of the PC's direct hosts
  /// when one answers. Returns whether it moved.
  ///
  /// The relay session stays the live one — answering requests, delivering
  /// notifications — until the direct one has completed its handshake; then
  /// the direct one is committed exactly as a validated switch is
  /// ([_commitSession]). If no host answers within the selector's per-host
  /// timeout, or the handshake fails, nothing changes. The bridge closes the
  /// relay connection itself once the direct one registers (it keeps one
  /// connection per phone), and that close is expected here, not a reason to
  /// reconnect.
  ///
  /// A no-op unless the live route is the relay and the PC advertises direct
  /// hosts, so a phone away from home pays one short, failed dial per network
  /// change or app resume, and nothing more.
  Future<bool> _tryDirectRoute() async {
    final live = _connectedDevice.value;
    final relayChannel = _channel;
    if (live == null ||
        relayChannel == null ||
        live.hosts.isEmpty ||
        _connectedRoute.value != ConnectionRoute.relay ||
        _switchingToDirect ||
        _reconnecting ||
        _connectionPhase.value != ConnectionPhase.connected) {
      return false;
    }
    bool stillOnRelay() =>
        !_disposed &&
        !_intentionalDisconnect &&
        !_reconnecting &&
        identical(_channel, relayChannel) &&
        _connectionPhase.value == ConnectionPhase.connected;

    _switchingToDirect = true;
    var moved = false;
    try {
      final transport = await _transportSelector.selectDirect(live);
      if (transport == null) return false;
      if (!stillOnRelay()) {
        unawaited(transport.disconnect().catchError((_) {}));
        return false;
      }
      // Advertise the freshest applied seq, so the bridge replays as little
      // as possible over the new channel.
      _persistBridgeSeq();
      final active = _activeMac.value;
      final device = active?.macDeviceId == live.macDeviceId ? active! : live;
      _holdingForSwitch = true;
      final (WebSocketTransport, SecureChannel) session;
      try {
        session = await _secureOver(
          transport,
          device,
          HandshakeMode.trustedReconnect,
        ).timeout(_directSwitchHandshakeTimeout);
      } on Object catch (error) {
        // A timeout leaves the handshake running: closing its socket ends it.
        AppLogger.warn(
          'Moving to a direct host failed; staying on the relay',
          error,
        );
        unawaited(transport.disconnect().catchError((_) {}));
        return false;
      }
      if (!stillOnRelay()) {
        unawaited(transport.disconnect().catchError((_) {}));
        return false;
      }
      // What the relay delivered while the handshake ran is replayed over the
      // new channel too (it was after the advertised seq): count it applied.
      session.$2.skipInboundThrough(relayChannel.session.bridgeOutboundSeq);
      await _commitSession(device, session);
      moved = true;
      return true;
    } finally {
      _switchingToDirect = false;
      _holdingForSwitch = false;
      final closed = _closedDuringSwitch;
      _closedDuringSwitch = null;
      if (!moved) {
        // Requests held for the handshake go out over the relay after all —
        // or, if the relay itself closed meanwhile, with the reconnect.
        if (closed != null && identical(closed, _transport)) {
          _handleClosed(closed);
        } else if (_connectionPhase.value == ConnectionPhase.connected) {
          await _flushOutbound();
        }
      }
    }
  }

  /// How long the handshake over a direct host that answered may take before
  /// the session gives up moving there and stays on the relay.
  static const Duration _directSwitchHandshakeTimeout = Duration(seconds: 8);

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
    _connectedEndpoint.add(null);
    _connectedRoute.add(null);
    _endConnectionSession();
    await _rxSubscription?.cancel();
    _rxSubscription = null;

    for (var attempt = 1; attempt <= _maxReconnectAttempts; attempt++) {
      final wait = _backoff.compute(attempt);
      final previous = _recoveryState.value;
      // The last failure stands while the next attempt waits, so the UI can
      // keep saying why ("your PC is offline") instead of going blank.
      _recoveryState.add(
        ConnectionRecoveryState(
          isRecovering: true,
          attempt: attempt,
          maxAttempts: _maxReconnectAttempts,
          nextRetryIn: wait,
          lastConnectedAt: previous.lastConnectedAt,
          lastErrorMessage: previous.lastErrorMessage,
          lastRelayFailure: previous.lastRelayFailure,
          lastTransportFailure: previous.lastTransportFailure,
        ),
      );
      await _waitForRetry(wait);
      if (_intentionalDisconnect || _disposed) return;
      try {
        await _establish(device, HandshakeMode.trustedReconnect);
        return;
      } on Object catch (error) {
        final current = _recoveryState.value;
        // Built whole rather than copied: a failure that was not the relay's
        // must clear the relay reason the attempt before left behind.
        _recoveryState.add(
          ConnectionRecoveryState(
            isRecovering: current.isRecovering,
            attempt: current.attempt,
            maxAttempts: current.maxAttempts,
            nextRetryIn: current.nextRetryIn,
            lastConnectedAt: current.lastConnectedAt,
            lastErrorMessage: error.toString(),
            lastRelayFailure: error is RelayException ? error.failure : null,
            lastTransportFailure:
                error is TransportException ? error.kind : null,
          ),
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
    await _connectedEndpoint.close();
    await _connectedRoute.close();
    await _connectingDevice.close();
    await _incoming.close();
  }

  /// Connect/reconnect path: drives the global phase (`connecting`), opens a
  /// session and commits it. On failure the global phase is left for the caller
  /// (reconnect loop) or the error handler to resolve.
  Future<void> _establish(
    TrustedDevice target,
    HandshakeMode mode, {
    String? relayTicket,
  }) async {
    _connectionPhase.add(ConnectionPhase.connecting);
    _connectingDevice.add(target);
    try {
      _connectionPhase.add(ConnectionPhase.handshaking);
      final device = await _withStoredRelay(target);
      final session = await _openSession(
        device,
        mode,
        relayTicket: relayTicket,
      );
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
    HandshakeMode mode, {
    String? relayTicket,
  }) async {
    final transport = await _transportSelector.select(
      device,
      relayTicket: relayTicket,
    );
    return _secureOver(transport, device, mode);
  }

  /// Runs the E2EE handshake for [device] over an already-connected
  /// [transport] and opens its channel, with no side effects on the current
  /// session. On failure the transport is closed and the error rethrown.
  Future<(WebSocketTransport, SecureChannel)> _secureOver(
    WebSocketTransport transport,
    TrustedDevice device,
    HandshakeMode mode,
  ) async {
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

  /// [device] with the relay the store holds for it now. The bridge shares its
  /// relay in its settings, and the replica writes it to the store
  /// (`BridgeReplica`) while the in-memory copy here is older — so a PC paired
  /// on the LAN is dialled through the relay it announced since, the moment
  /// the phone leaves home. The rest of the copy stands (its applied sequence
  /// is ahead of the store's).
  Future<TrustedDevice> _withStoredRelay(TrustedDevice device) async {
    final repository = _trustedDeviceRepository;
    if (repository == null) return device;
    final TrustedDevice? stored;
    try {
      stored = await repository.getDevice(device.macDeviceId);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Reading the stored relay failed', error, stackTrace);
      return device;
    }
    if (stored == null || stored.relay == device.relay) return device;
    final active = _activeMac.value;
    if (active != null && active.macDeviceId == device.macDeviceId) {
      _activeMac.add(active.withRelay(stored.relay));
    }
    return device.withRelay(stored.relay);
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
    // The session being replaced (a validated switch, or leaving the relay
    // for a direct host) ends its connection-log row here.
    _endConnectionSession();
    await _rxSubscription?.cancel();
    _rxSubscription = null;
    final previous = _transport;
    _transport = transport;
    _channel = channel;
    // The old connection is let go, not waited on: after a network change it
    // may be dead, and the new session must not hang on its goodbye.
    if (previous != null && !identical(previous, transport)) {
      unawaited(previous.disconnect().catchError((_) {}));
    }
    _connectionPhase.add(ConnectionPhase.syncing);
    _startReceiving(transport);
    await _flushOutbound();
    _connectedDevice.add(device);
    // Surface the real endpoint in use (the winning direct host, or the relay)
    // so the PC card shows the address we're actually connected through, and
    // classify it once for every surface that names the route.
    final url = transport.connectedUrl;
    final route = routeOfEndpoint(url, relay: device.relay);
    _connectedEndpoint.add(url);
    _connectedRoute.add(route);
    _startConnectionSession(device, url, route);
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
      onDone: () => _handleClosed(transport),
      onError: (Object _, StackTrace __) => _handleClosed(transport),
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

  void _handleClosed(WebSocketTransport transport) {
    if (_intentionalDisconnect ||
        _disposed ||
        _connectionPhase.value == ConnectionPhase.reconnecting) {
      return;
    }
    // A connection already replaced by a newer one closing is expected.
    if (!identical(transport, _transport)) return;
    // The relay connection closing while the session moves to a direct host
    // is the bridge letting go of it: [_tryDirectRoute] decides once the move
    // has succeeded or failed.
    if (_switchingToDirect) {
      _closedDuringSwitch = transport;
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
