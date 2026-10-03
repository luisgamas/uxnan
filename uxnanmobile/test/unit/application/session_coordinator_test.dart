import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:async/async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/coordinators/session_coordinator.dart';
import 'package:uxnan/core/constants/protocol_constants.dart';
import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/connection_recovery_state.dart';
import 'package:uxnan/domain/entities/connection_session.dart';
import 'package:uxnan/domain/entities/discovered_bridge.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/secure_session.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/connection_route.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';
import 'package:uxnan/domain/enums/relay_reason.dart';
import 'package:uxnan/domain/repositories/i_connection_session_repository.dart';
import 'package:uxnan/domain/repositories/i_trusted_device_repository.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/secure_envelope.dart';
import 'package:uxnan/infrastructure/crypto/handshake_crypto.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
import 'package:uxnan/infrastructure/discovery/bridge_discovery_service.dart';
import 'package:uxnan/infrastructure/transport/relay_client.dart';
import 'package:uxnan/infrastructure/transport/secure_transport_layer.dart';
import 'package:uxnan/infrastructure/transport/transport_selector.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

const _relay = RelayEndpoint(
  url: 'wss://relay.test',
  routingId: '0123456789abcdef0123456789abcdef',
  enabled: true,
);

const _relayPhoneUrl =
    'wss://relay.test/v1/connect/0123456789abcdef0123456789abcdef';

class _InMemoryTransport implements WebSocketTransport {
  final StreamController<Uint8List> incomingController =
      StreamController<Uint8List>.broadcast();
  late _InMemoryTransport peer;

  @override
  String? connectedUrl;

  @override
  Stream<Uint8List> get incoming => incomingController.stream;

  @override
  Stream<TransportState> get stateChanges => const Stream.empty();

  @override
  int? closeCode;

  @override
  Future<void> connect(String url) async {
    connectedUrl = url;
  }

  @override
  Future<void> disconnect() async => forceClose();

  @override
  Future<void> send(Uint8List data) async {
    if (!peer.incomingController.isClosed) peer.incomingController.add(data);
  }

  @override
  Future<void> sendText(String text) =>
      send(Uint8List.fromList(utf8.encode(text)));

  Future<void> forceClose() async {
    if (!incomingController.isClosed) await incomingController.close();
  }
}

Uint8List _jsonBytes(Map<String, dynamic> json) =>
    Uint8List.fromList(utf8.encode(jsonEncode(json)));

Map<String, dynamic> _json(Uint8List bytes) =>
    jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;

/// A persistent simulated bridge: completes the handshake then echoes requests.
class _FakeBridge {
  _FakeBridge(this.transport, this.identity, this.handler, {this.beforeReady});

  final _InMemoryTransport transport;
  final Ed25519KeyPairBytes identity;
  final RpcMessage Function(RpcMessage request) handler;

  /// Runs once the handshake is authenticated, before `ready` goes out — where
  /// the real bridge registers the new connection and closes the phone's
  /// previous one.
  final Future<void> Function()? beforeReady;

  final HandshakeCrypto _crypto = HandshakeCrypto();
  final KeyGeneration _keygen = KeyGeneration();
  late SecureChannel _channel;

  /// The `resumeState.lastAppliedBridgeOutboundSeq` carried by this bridge's
  /// clientHello (null when absent), captured for catch-up assertions.
  int? helloResumeSeq;

  Future<void> run() async {
    final queue = StreamQueue<Uint8List>(transport.incoming);
    try {
      final hello = _json(await queue.next);
      helloResumeSeq = (hello['resumeState']
          as Map<String, dynamic>?)?['lastAppliedBridgeOutboundSeq'] as int?;
      final clientNonce = (hello['clientNonce'] as String).fromHex();
      final phoneEphPub =
          (hello['phoneEphemeralPublicKey'] as String).fromHex();
      final sessionId = hello['sessionId'] as String;

      final bridgeEph = await _keygen.generateEphemeralKeyPair();
      final serverNonce = _keygen.randomBytes(32);
      const keyEpoch = 1;
      final expiresAt = DateTime(2035).millisecondsSinceEpoch;

      final transcript = _crypto.buildTranscript(
        HandshakeTranscriptInput(
          clientNonce: clientNonce,
          phoneEphemeralPublicKey: phoneEphPub,
          macEphemeralPublicKey: bridgeEph.publicKey,
          serverNonce: serverNonce,
          sessionId: sessionId,
          keyEpoch: keyEpoch,
          expiresAtForTranscript: expiresAt,
        ),
      );
      final macSignature = await _crypto.sign(transcript, identity.privateSeed);

      await transport.send(
        _jsonBytes({
          'kind': 'serverHello',
          'protocolVersion': ProtocolConstants.secureProtocolVersion,
          'sessionId': sessionId,
          'macDeviceId': 'mac-1',
          'macIdentityPublicKey': identity.publicKey.toHex(),
          'macEphemeralPublicKey': bridgeEph.publicKey.toHex(),
          'serverNonce': serverNonce.toHex(),
          'keyEpoch': keyEpoch,
          'expiresAtForTranscript': expiresAt,
          'macSignature': macSignature.toHex(),
          'clientNonce': clientNonce.toHex(),
          'displayName': 'Test Bridge',
        }),
      );

      await queue.next; // clientAuth (signature already trusted in this fake)

      final key = await _crypto.deriveSessionKey(
        phoneEphemeralPrivateKey: bridgeEph.privateKey,
        macEphemeralPublicKey: phoneEphPub,
        clientNonce: clientNonce,
        serverNonce: serverNonce,
      );
      // role: bridge — this fake plays the BRIDGE side of the wire (it
      // decrypts inbound phone->bridge requests and encrypts outbound
      // bridge->phone notifications), the mirror image of the real phone
      // client under test, so their AAD directions (architecture/02a §5.9.1)
      // actually agree.
      final channel = SecureChannel(
        SecureSession(
          sessionId: sessionId,
          macDeviceId: 'mac-1',
          phoneDeviceId: 'phone-1',
          derivedKey: key,
          keyEpoch: keyEpoch,
          mode: HandshakeMode.qrBootstrap,
        ),
        role: SecureChannelRole.bridge,
      );
      _channel = channel;

      await beforeReady?.call();

      // Send ready only after the channel is ready, so a notification pushed
      // right after the phone connects cannot race ahead of it.
      await transport.send(
        _jsonBytes({
          'kind': 'ready',
          'sessionId': sessionId,
          'keyEpoch': keyEpoch,
          'macDeviceId': 'mac-1',
        }),
      );

      while (await queue.hasNext) {
        final raw = await queue.next;
        if (_json(raw)['kind'] != SecureEnvelope.kind) continue;
        final request = RpcMessage.fromJson(
          _json(await channel.decrypt(SecureEnvelope.fromJson(_json(raw)))),
        );
        await _sendMessage(handler(request));
      }
    } finally {
      await queue.cancel(immediate: true);
    }
  }

  Future<void> pushNotification(RpcMessage notification) =>
      _sendMessage(notification);

  Future<void> _sendMessage(RpcMessage message) async {
    final envelope = await _channel.encrypt(
      Uint8List.fromList(utf8.encode(jsonEncode(message.toJson()))),
    );
    await transport.send(_jsonBytes(envelope.toJson()));
  }
}

/// A network for the REAL [DirectTransportSelector]: addresses where the
/// trusted PC listens, addresses where a spoofer accepts the socket and runs
/// the handshake with its own identity (so the phone's real signature check
/// is what rejects it), and the PC's relay, which speaks the relay control
/// protocol (`challenge` → `phone-auth` → `ready`) and then reaches the PC.
/// Every other address refuses the socket.
class _Lan {
  _Lan({
    required this.pc,
    required this.spoofer,
    required this.handler,
    this.pcHosts = const {},
    this.spoofHosts = const {},
  });

  final Ed25519KeyPairBytes pc;
  final Ed25519KeyPairBytes spoofer;
  final RpcMessage Function(RpcMessage request) handler;
  final Set<String> pcHosts;
  final Set<String> spoofHosts;

  /// Every URL dialed, in order.
  final List<String> dials = [];

  int dialsTo(String host) => dials.where((u) => u.contains(host)).length;
}

class _LanTransport extends _InMemoryTransport {
  _LanTransport(this.lan);

  final _Lan lan;
  bool _relayAuthPending = false;

  @override
  Future<void> connect(String url) async {
    connectedUrl = url;
    lan.dials.add(url);
    if (url.contains('/v1/connect/')) {
      _relayAuthPending = true;
      _attach(lan.pc);
      Timer.run(
        () => incomingController.add(
          _jsonBytes({'t': 'challenge', 'v': 1, 'nonce': 'cd' * 32}),
        ),
      );
      return;
    }
    final host = url.replaceFirst('ws://', '');
    if (lan.pcHosts.contains(host)) return _attach(lan.pc);
    if (lan.spoofHosts.contains(host)) return _attach(lan.spoofer);
    throw StateError('unreachable: $url');
  }

  void _attach(Ed25519KeyPairBytes identity) {
    final bridge = _InMemoryTransport();
    peer = bridge;
    bridge.peer = this;
    unawaited(_FakeBridge(bridge, identity, lan.handler).run());
  }

  @override
  Future<void> sendText(String text) async {
    if (_relayAuthPending) {
      _relayAuthPending = false;
      Timer.run(() => incomingController.add(_jsonBytes({'t': 'ready'})));
      return;
    }
    return super.sendText(text);
  }
}

/// What the network announces on `_uxnan._tcp`, in the TXT shape the bridge
/// advertises (`mdns-advertiser.ts`) — which a spoofer can copy, PC id and all.
class _Announced implements LanBridgeFinder {
  _Announced(this.addresses);

  final List<String> addresses;

  @override
  Stream<DiscoveredBridge> find(String deviceId, {required Duration window}) {
    Uint8List txt(String v) => Uint8List.fromList(utf8.encode(v));
    return Stream.fromIterable([
      for (final address in addresses)
        parseDiscoveredBridge(
          name: 'Studio',
          host: 'Studio.local',
          port: 19850,
          addresses: [InternetAddress(address)],
          txt: {
            'v': txt('1'),
            'id': txt(deviceId),
            'port': txt('19850'),
            'addr': txt(address),
          },
        )!,
    ]);
  }
}

class _FakeSelector implements TransportSelector {
  _FakeSelector(this.identity, this.handler);

  final Ed25519KeyPairBytes identity;
  final RpcMessage Function(RpcMessage request) handler;
  final List<_InMemoryTransport> phoneSides = [];
  _FakeBridge? currentBridge;

  /// Device ids the selector should treat as unreachable (throws on select).
  final Set<String> unreachable = {};

  /// Errors the next selects throw, in order (a relay refusing, say).
  final List<Object> failNext = [];

  /// Every device asked for, with the relay ticket it came with, in order.
  final List<(TrustedDevice, String?)> selected = [];

  /// What the selector found on the way, as the real one reports it: the PC
  /// seen on the phone's network although none of its addresses answered.
  RelayReason? relayReason;

  @override
  Future<TransportSelection<S>> select<S>(
    TrustedDevice device, {
    required TransportSecurer<S> secure,
    String? relayTicket,
  }) async {
    selected.add((device, relayTicket));
    if (failNext.isNotEmpty) {
      final failure = failNext.removeAt(0);
      if (failure is Exception) throw failure;
      throw failure as Error;
    }
    if (unreachable.contains(device.macDeviceId)) {
      throw StateError('unreachable: ${device.macDeviceId}');
    }
    final phone = _InMemoryTransport();
    final bridge = _InMemoryTransport();
    phone.peer = bridge;
    bridge.peer = phone;
    // Mirror the real selector: the winning transport records the endpoint it
    // connected through (the relay here, or a direct ws:// host), so the
    // coordinator can surface the real address in use.
    final relay = device.relay;
    phone.connectedUrl = relay != null
        ? '${relay.url}/v1/connect/${relay.routingId}'
        : (device.hosts.isNotEmpty ? 'ws://${device.hosts.first}' : null);
    phoneSides.add(phone);
    final fakeBridge = _FakeBridge(bridge, identity, handler);
    currentBridge = fakeBridge;
    unawaited(fakeBridge.run());
    // The real selector handshakes each candidate itself.
    return TransportSelection(
      phone,
      await secure(phone),
      relayReason: relay != null ? relayReason : null,
    );
  }

  /// Whether the PC's direct hosts answer [selectDirect].
  bool directReachable = false;

  /// How many times the direct hosts were dialed on their own.
  int directDials = 0;

  /// When true, a direct connection's handshake closes the connection it
  /// replaces before `ready` — as the real bridge does when it registers a
  /// phone's newer connection.
  bool supersede = true;

  /// The device every [selectDirect] was asked for, in order — the hosts the
  /// session read from the store.
  final List<TrustedDevice> directAsked = [];

  /// While set, [selectDirect] waits on it before answering (a try in
  /// flight).
  Completer<void>? directGate;

  @override
  Future<DirectSelection<S>> selectDirect<S>(
    TrustedDevice device, {
    required TransportSecurer<S> secure,
  }) async {
    directDials++;
    directAsked.add(device);
    final gate = directGate;
    if (gate != null) await gate.future;
    if (!directReachable || device.hosts.isEmpty) {
      return DirectSelection<S>(relayReason: relayReason);
    }
    final previous = phoneSides.isEmpty ? null : phoneSides.last;
    final phone = _InMemoryTransport();
    final bridge = _InMemoryTransport();
    phone
      ..peer = bridge
      ..connectedUrl = 'ws://${device.hosts.first}';
    bridge.peer = phone;
    phoneSides.add(phone);
    final fakeBridge = _FakeBridge(
      bridge,
      identity,
      handler,
      beforeReady: supersede && previous != null
          ? () async {
              await previous.peer.forceClose();
              await previous.forceClose();
            }
          : null,
    );
    currentBridge = fakeBridge;
    unawaited(fakeBridge.run());
    try {
      return DirectSelection(transport: phone, secured: await secure(phone));
    } on Object {
      return const DirectSelection(
        relayReason: RelayReason.directHandshakeFailed,
      );
    }
  }

  Future<void> dropCurrent() async {
    await phoneSides.last.forceClose();
    await phoneSides.last.peer.forceClose();
  }
}

class _FakeConnectionSessionRepo implements IConnectionSessionRepository {
  final List<ConnectionSession> sessions = [];
  int danglingClosedCalls = 0;

  @override
  Future<void> startSession(ConnectionSession session) async =>
      sessions.add(session);

  @override
  Future<void> touchSession(String id, DateTime at) async =>
      _replace(id, (s) => s.isOpen ? s.copyWith(lastActiveAt: at) : s);

  @override
  Future<void> endSession(String id, DateTime endedAt) async =>
      _replace(id, (s) => s.isOpen ? s.copyWith(endedAt: endedAt) : s);

  @override
  Future<void> closeDanglingSessions() async {
    danglingClosedCalls++;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].isOpen) {
        sessions[i] = sessions[i].copyWith(endedAt: sessions[i].lastActiveAt);
      }
    }
  }

  @override
  Future<List<ConnectionSession>> getAll() async => List.of(sessions);

  @override
  Stream<List<ConnectionSession>> watchAll() => Stream.value(List.of(sessions));

  void _replace(String id, ConnectionSession Function(ConnectionSession) f) {
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id == id) {
        sessions[i] = f(sessions[i]);
        return;
      }
    }
  }
}

class _FakeTrustedDeviceRepo implements ITrustedDeviceRepository {
  final Map<String, TrustedDevice> devices = {};

  @override
  Future<void> saveDevice(TrustedDevice device) async =>
      devices[device.macDeviceId] = device;

  @override
  Future<TrustedDevice?> getDevice(String macDeviceId) async =>
      devices[macDeviceId];

  @override
  Future<List<TrustedDevice>> getDevices() async => devices.values.toList();

  @override
  Stream<List<TrustedDevice>> watchDevices() =>
      Stream.value(devices.values.toList());

  @override
  Future<void> deleteDevice(String macDeviceId) async =>
      devices.remove(macDeviceId);

  @override
  Future<void> rename(String macDeviceId, String name) async {
    final d = devices[macDeviceId];
    if (d != null) devices[macDeviceId] = d.copyWith(displayName: name);
  }

  @override
  Future<void> recordRelay(String macDeviceId, RelayEndpoint? relay) async {
    final d = devices[macDeviceId];
    if (d != null) devices[macDeviceId] = d.withRelay(relay);
  }

  @override
  Future<void> recordHosts(String macDeviceId, List<String> hosts) async {
    final d = devices[macDeviceId];
    if (d != null) devices[macDeviceId] = d.copyWith(hosts: hosts);
  }

  @override
  Future<void> recordLastSeen(String macDeviceId, DateTime at) async {
    final d = devices[macDeviceId];
    if (d != null) devices[macDeviceId] = d.copyWith(lastSeen: at);
  }

  @override
  Future<void> recordBridgeOutboundSeq(String macDeviceId, int seq) async {
    final d = devices[macDeviceId];
    if (d != null && seq > d.lastAppliedBridgeOutboundSeq) {
      devices[macDeviceId] = d.copyWith(lastAppliedBridgeOutboundSeq: seq);
    }
  }
}

void main() {
  late KeyGeneration keygen;
  late Ed25519KeyPairBytes bridgeId;

  setUp(() {
    keygen = KeyGeneration();
  });

  Future<
      ({
        SessionCoordinator coordinator,
        _FakeSelector selector,
        _FakeTrustedDeviceRepo repo,
        _FakeConnectionSessionRepo connectionRepo,
      })> build(
    RpcMessage Function(RpcMessage) handler, {
    bool setActive = true,
    DelayFn? delay,
    RelayEndpoint? relay = _relay,
    List<String> hosts = const [],
  }) async {
    bridgeId = await keygen.generateIdentityKeyPair();
    final phoneId = await keygen.generateIdentityKeyPair();
    final selector = _FakeSelector(bridgeId, handler);
    final repo = _FakeTrustedDeviceRepo();
    final connectionRepo = _FakeConnectionSessionRepo();
    final coordinator = SessionCoordinator(
      secureTransport: SecureTransportLayer(),
      transportSelector: selector,
      trustedDeviceRepository: repo,
      connectionSessionRepository: connectionRepo,
      identityResolver: () async => PhoneIdentity(
        phoneDeviceId: 'phone-1',
        publicKey: phoneId.publicKey,
        privateSeed: phoneId.privateSeed,
      ),
      delay: delay ?? (_) async {}, // elide backoff in tests by default
      directRetryDebounce: const Duration(milliseconds: 10),
    );
    if (setActive) {
      // A PC is active only once it is paired, so its record is stored.
      final pc = TrustedDevice(
        macDeviceId: 'mac-1',
        displayName: 'Test Bridge',
        macIdentityPublicKey: bridgeId.publicKey,
        relay: relay,
        hosts: hosts,
        sessionId: 'session-xyz',
        pairedAt: DateTime(2026),
      );
      await repo.saveDevice(pc);
      coordinator.setActiveDevice(pc);
    }
    return (
      coordinator: coordinator,
      selector: selector,
      repo: repo,
      connectionRepo: connectionRepo,
    );
  }

  RpcMessage echo(RpcMessage request) =>
      RpcMessage.response(id: request.id!, result: {'echo': request.method});

  test('connects through the handshake to the connected phase', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);

    await harness.coordinator.connect(forceQrBootstrap: true);

    expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    expect(harness.coordinator.activeMac?.macDeviceId, 'mac-1');
    expect(harness.coordinator.connectedDevice?.macDeviceId, 'mac-1');
  });

  test('logs a connection session on connect and closes it on disconnect',
      () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    // Dangling sessions from a prior run are closed once at construction.
    expect(harness.connectionRepo.danglingClosedCalls, 1);

    await harness.coordinator.connect(forceQrBootstrap: true);
    var sessions = await harness.connectionRepo.getAll();
    expect(sessions, hasLength(1));
    expect(sessions.first.deviceId, 'mac-1');
    expect(sessions.first.isOpen, isTrue);
    // The active device is relay-only, so the transport is recorded as relay.
    expect(sessions.first.transport, ConnectionTransport.relay);

    await harness.coordinator.disconnect();
    sessions = await harness.connectionRepo.getAll();
    expect(sessions.first.isOpen, isFalse);
  });

  test('exposes the connected endpoint while live, clears it on disconnect',
      () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);

    await harness.coordinator.connect(forceQrBootstrap: true);
    // The winning transport's endpoint is surfaced so the UI can show the real
    // address in use (the relay here, per the active device).
    expect(harness.coordinator.connectedEndpoint, _relayPhoneUrl);

    await harness.coordinator.disconnect();
    expect(harness.coordinator.connectedEndpoint, isNull);
  });

  test('switchMac keeps the current session when the target is unreachable',
      () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);

    await harness.coordinator.connect();
    expect(harness.coordinator.connectedDevice?.macDeviceId, 'mac-1');

    harness.selector.unreachable.add('mac-2');
    final target = TrustedDevice(
      macDeviceId: 'mac-2',
      displayName: 'PC2',
      macIdentityPublicKey: bridgeId.publicKey,
      relay: _relay,
      sessionId: 'session-2',
      pairedAt: DateTime(2026),
    );

    await expectLater(
      harness.coordinator.switchMac(target),
      throwsA(anything),
    );

    // The unreachable target must NOT become the live device; we stay on mac-1.
    expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    expect(harness.coordinator.connectedDevice?.macDeviceId, 'mac-1');
  });

  test('sendRequest resolves with the bridge response', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    final response = await harness.coordinator
        .sendRequest('git/status', {'cwd': '/p'}).timeout(
      const Duration(seconds: 5),
    );

    expect(response.isResponse, isTrue);
    expect((response.result! as Map)['echo'], 'git/status');
  });

  test('emits inbound notifications on incomingMessages', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    final received = harness.coordinator.incomingMessages.first
        .timeout(const Duration(seconds: 5));
    await harness.selector.currentBridge!.pushNotification(
      RpcMessage.notification(
        method: 'stream/turn/started',
        params: const {'turnId': 't1'},
      ),
    );

    final notification = await received;
    expect(notification.method, 'stream/turn/started');
    expect(notification.isNotification, isTrue);
  });

  test('disconnect moves to the disconnected phase', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    await harness.coordinator.disconnect();
    expect(harness.coordinator.connectionPhase, ConnectionPhase.disconnected);
  });

  test('reconnects automatically after an unexpected drop', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    final sawReconnecting = harness.coordinator.connectionPhaseStream
        .firstWhere((p) => p == ConnectionPhase.reconnecting)
        .timeout(const Duration(seconds: 5));
    await harness.selector.dropCurrent();
    await sawReconnecting;

    await harness.coordinator.connectionPhaseStream
        .firstWhere((p) => p == ConnectionPhase.connected)
        .timeout(const Duration(seconds: 5));

    expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    // A request works again over the fresh session.
    final response = await harness.coordinator.sendRequest('ping').timeout(
          const Duration(seconds: 5),
        );
    expect((response.result! as Map)['echo'], 'ping');
  });

  test(
      "the reconnect loop keeps the relay's reason while it retries, and "
      'drops it once the failure is something else', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    final states = <ConnectionRecoveryState>[];
    final sub = harness.coordinator.recoveryStateStream.listen(states.add);
    addTearDown(sub.cancel);
    harness.selector.failNext.addAll([
      const RelayException(RelayFailure.bridgeOffline, 'bridge offline'),
      StateError('no route'),
    ]);
    await harness.selector.dropCurrent();
    await harness.coordinator.connectionPhaseStream
        .firstWhere((p) => p == ConnectionPhase.connected)
        .timeout(const Duration(seconds: 5));
    await pumpEventQueue();

    final reasons = [for (final s in states) s.lastRelayFailure];
    // Attempt 1 fails at the relay; attempt 2 waits still saying why; its
    // own failure is not the relay's, which clears the reason.
    expect(
      reasons,
      containsAllInOrder([
        RelayFailure.bridgeOffline,
        RelayFailure.bridgeOffline,
        null,
      ]),
    );
    expect(
      states
          .where((s) => s.attempt == 2 && s.isRecovering)
          .first
          .lastRelayFailure,
      RelayFailure.bridgeOffline,
    );
    // Back online: nothing to explain any more.
    expect(states.last.lastRelayFailure, isNull);
    expect(states.last.isRecovering, isFalse);
  });

  test('resume() retries immediately when a reconnect backoff is pending',
      () async {
    final reached = Completer<void>();
    final blocked = Completer<void>();
    // A delay that parks forever (until woken) and signals once entered, so the
    // test knows the reconnect loop is sitting in its backoff.
    final harness = await build(
      echo,
      delay: (_) {
        if (!reached.isCompleted) reached.complete();
        return blocked.future;
      },
    );
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    // Drop → the reconnect loop enters and parks on the (never-completing)
    // delay.
    await harness.selector.dropCurrent();
    await reached.future.timeout(const Duration(seconds: 5));

    // Resume wakes the backoff so the next attempt runs now — without ever
    // waiting the delay out.
    await harness.coordinator.resume();
    await harness.coordinator.connectionPhaseStream
        .firstWhere((p) => p == ConnectionPhase.connected)
        .timeout(const Duration(seconds: 5));

    expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    expect(blocked.isCompleted, isFalse);
  });

  test('resume() is a no-op after an intentional disconnect', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);
    await harness.coordinator.disconnect();
    expect(harness.coordinator.connectionPhase, ConnectionPhase.disconnected);

    await harness.coordinator.resume();
    // Stays disconnected — backgrounding after the user disconnected must not
    // silently reconnect.
    expect(harness.coordinator.connectionPhase, ConnectionPhase.disconnected);
  });

  test(
      'resume() holds a concurrent send until the probe confirms, then '
      'delivers it (not lost to a half-open socket)', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);
    expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);

    // Resume kicks the liveness probe; a user message sent during that window
    // is held in the buffer (not written to a possibly-dead socket), then
    // flushed once the probe confirms the link. It must still resolve.
    final resuming = harness.coordinator.resume();
    final sending = harness.coordinator.sendRequest('turn/send', {'x': 1});
    await resuming;
    final response = await sending.timeout(const Duration(seconds: 2));

    expect((response.result! as Map)['echo'], 'turn/send');
    expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
  });

  test('removeTrustedDevice notifies the bridge with the phone id, disconnects',
      () async {
    final requests = <RpcMessage>[];
    final harness = await build((req) {
      requests.add(req);
      return RpcMessage.response(id: req.id!);
    });
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);
    expect(harness.coordinator.connectedDevice?.macDeviceId, 'mac-1');

    await harness.coordinator.removeTrustedDevice(
      TrustedDevice(
        macDeviceId: 'mac-1',
        displayName: 'Test Bridge',
        macIdentityPublicKey: bridgeId.publicKey,
        relay: _relay,
        sessionId: 'session-xyz',
        pairedAt: DateTime(2026),
      ),
    );

    final removal = requests.firstWhere(
      (r) => r.method == 'bridge/removeTrustedDevice',
    );
    // Revokes THIS phone's trust (the phone's own id), not the PC id.
    expect((removal.params! as Map)['deviceId'], 'phone-1');
    expect(harness.coordinator.connectionPhase, ConnectionPhase.disconnected);
  });

  test('removeTrustedDevice is a no-op for a device we are not connected to',
      () async {
    final requests = <RpcMessage>[];
    final harness = await build((req) {
      requests.add(req);
      return RpcMessage.response(id: req.id!);
    });
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    await harness.coordinator.removeTrustedDevice(
      TrustedDevice(
        macDeviceId: 'mac-other',
        displayName: 'Other PC',
        macIdentityPublicKey: bridgeId.publicKey,
        relay: _relay,
        sessionId: 'session-other',
        pairedAt: DateTime(2026),
      ),
    );

    expect(
      requests.where((r) => r.method == 'bridge/removeTrustedDevice'),
      isEmpty,
    );
    expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
  });

  test('persists the applied bridge seq on disconnect for catch-up', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    // The bridge pushes a notification (bridge→phone seq 1); the phone applies
    // it, advancing the channel's bridgeOutboundSeq.
    final received = harness.coordinator.incomingMessages.first
        .timeout(const Duration(seconds: 5));
    await harness.selector.currentBridge!.pushNotification(
      RpcMessage.notification(method: 'stream/turn/started'),
    );
    await received;

    await harness.coordinator.disconnect();
    await Future<void>.delayed(Duration.zero); // let the async save land

    final saved = await harness.repo.getDevice('mac-1');
    expect(saved!.lastAppliedBridgeOutboundSeq, 1);
  });

  // A PC renamed while the phone was connected kept coming back under its old
  // name: advancing the cursor wrote the whole record from an older copy.
  test('the connection never undoes a rename of the PC it is connected to',
      () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);
    await harness.repo.rename('mac-1', 'MacBook');

    final received = harness.coordinator.incomingMessages.first
        .timeout(const Duration(seconds: 5));
    await harness.selector.currentBridge!.pushNotification(
      RpcMessage.notification(method: 'stream/turn/started'),
    );
    await received;
    await harness.coordinator.disconnect();
    await Future<void>.delayed(Duration.zero);

    final saved = await harness.repo.getDevice('mac-1');
    expect(saved!.displayName, 'MacBook');
    expect(saved.lastAppliedBridgeOutboundSeq, 1);
  });

  test('advertises resumeState on reconnect so the bridge replays the backlog',
      () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    final received = harness.coordinator.incomingMessages.first
        .timeout(const Duration(seconds: 5));
    await harness.selector.currentBridge!.pushNotification(
      RpcMessage.notification(method: 'stream/turn/started'),
    );
    await received;
    await harness.coordinator.disconnect();
    await Future<void>.delayed(Duration.zero);

    // Reconnect: the new clientHello must carry resumeState = the applied seq.
    await harness.coordinator.connect();
    expect(harness.selector.currentBridge!.helloResumeSeq, 1);
  });

  test('a first connection sends no resumeState', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);
    expect(harness.selector.currentBridge!.helloResumeSeq, isNull);
  });

  test('processPairingPayload registers the device and connects', () async {
    final harness = await build(echo, setActive: false);
    addTearDown(harness.coordinator.dispose);

    final payload = PairingPayload(
      version: 3,
      relay: _relay,
      relayTicket: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      hosts: const [],
      sessionId: 'session-xyz',
      macDeviceId: 'mac-1',
      macIdentityPublicKey: bridgeId.publicKey,
      expiresAt: DateTime(2035).millisecondsSinceEpoch,
      displayName: 'Test Bridge',
    );

    await harness.coordinator.processPairingPayload(payload);

    expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    expect(harness.coordinator.activeMac?.macDeviceId, 'mac-1');
    final saved = await harness.repo.getDevice('mac-1');
    expect(saved, isNotNull);
    expect(saved!.macIdentityPublicKey, bridgeId.publicKey);
    expect(saved.relay, _relay);
    // The relay's one-time pairing ticket goes with the first dial only.
    expect(harness.selector.selected.single.$2, isNotNull);

    await harness.selector.dropCurrent();
    await _until(() => harness.selector.selected.length == 2);
    expect(harness.selector.selected.last.$2, isNull);
  });

  test('dials through the relay the PC announced since it was paired',
      () async {
    final harness = await build(echo, setActive: false);
    addTearDown(harness.coordinator.dispose);
    // Paired on the LAN: no relay yet.
    final pc = TrustedDevice(
      macDeviceId: 'mac-1',
      displayName: 'Test Bridge',
      macIdentityPublicKey: bridgeId.publicKey,
      hosts: const ['192.168.1.5:19850'],
      sessionId: 'session-xyz',
      pairedAt: DateTime(2026),
    );
    await harness.repo.saveDevice(pc);
    harness.coordinator.setActiveDevice(pc);
    await harness.coordinator.connect();
    expect(harness.selector.selected.single.$1.relay, isNull);

    // Its bridge then shares a relay (stored by the replica), and the
    // connection drops — the phone left home.
    await harness.repo.recordRelay('mac-1', _relay);
    await harness.selector.dropCurrent();
    await _until(() => harness.selector.selected.length == 2);
    await _until(
      () => harness.coordinator.connectionPhase == ConnectionPhase.connected,
    );

    expect(harness.selector.selected.last.$1.relay, _relay);
    expect(harness.coordinator.activeMac?.relay, _relay);
    expect(harness.coordinator.connectedDevice?.relay, _relay);
    final sessions = await harness.connectionRepo.getAll();
    expect(sessions.last.transport, ConnectionTransport.relay);
  });

  group('route and the way back home', () {
    const lanHost = '192.168.1.5:19850';

    test('classifies the live route once, and clears it on disconnect',
        () async {
      final harness = await build(echo);
      addTearDown(harness.coordinator.dispose);

      await harness.coordinator.connect(forceQrBootstrap: true);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);

      await harness.coordinator.disconnect();
      expect(harness.coordinator.connectedRoute, isNull);
    });

    test('a direct tailnet host is Tailscale', () async {
      final harness = await build(
        echo,
        relay: null,
        hosts: const ['100.76.97.16:19850'],
      );
      addTearDown(harness.coordinator.dispose);

      await harness.coordinator.connect(forceQrBootstrap: true);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.tailscale);
    });

    test(
        'on a network change a relay session moves to a direct host that '
        'answers, without dropping the session', () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);

      final phases = <ConnectionPhase>[];
      final sub = harness.coordinator.connectionPhaseStream.listen(phases.add);
      addTearDown(sub.cancel);
      harness.selector.directReachable = true;

      await harness.coordinator.handleNetworkChange();
      await pumpEventQueue();

      expect(harness.coordinator.connectedRoute, ConnectionRoute.lan);
      expect(harness.coordinator.connectedEndpoint, 'ws://$lanHost');
      expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
      // The bridge closed the relay connection itself when the direct one
      // registered; that was expected, never a reason to reconnect.
      expect(phases, isNot(contains(ConnectionPhase.reconnecting)));
      expect(harness.selector.selected, hasLength(1));
      // Requests now travel the direct channel.
      final response = await harness.coordinator
          .sendRequest('ping')
          .timeout(const Duration(seconds: 5));
      expect((response.result! as Map)['echo'], 'ping');
      // The connection log closed the relay session and opened a direct one.
      final sessions = await harness.connectionRepo.getAll();
      expect(
        sessions.map((s) => s.transport),
        [ConnectionTransport.relay, ConnectionTransport.direct],
      );
      expect(sessions.first.isOpen, isFalse);
      expect(sessions.last.isOpen, isTrue);
    });

    test('a request sent while the move runs is delivered over the new path',
        () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);
      harness.selector.directReachable = true;

      final moving = harness.coordinator.handleNetworkChange();
      // Let the direct host answer, so the handshake is what is running.
      await Future<void>.delayed(Duration.zero);
      final sending = harness.coordinator.sendRequest('turn/send');
      await moving;

      final response = await sending.timeout(const Duration(seconds: 5));
      expect((response.result! as Map)['echo'], 'turn/send');
      expect(harness.coordinator.connectedRoute, ConnectionRoute.lan);
    });

    test('stays on the relay when no direct host answers', () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);

      await harness.coordinator.handleNetworkChange();

      expect(harness.selector.directDials, 1);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);
      expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
      final response = await harness.coordinator
          .sendRequest('ping')
          .timeout(const Duration(seconds: 5));
      expect((response.result! as Map)['echo'], 'ping');
    });

    test('resume() also brings a relay session home', () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);
      harness.selector.directReachable = true;

      await harness.coordinator.resume();
      await pumpEventQueue();

      expect(harness.coordinator.connectedRoute, ConnectionRoute.lan);
      expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    });

    test('a direct session never dials again on a network change', () async {
      final harness = await build(echo, relay: null, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.lan);
      harness.selector.directReachable = true;

      await harness.coordinator.handleNetworkChange();

      expect(harness.selector.directDials, 0);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.lan);
      expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    });

    test(
        "the PC's new addresses bring a relay session home — the ones the "
        'store holds now, not the pairing-day ones', () async {
      // Paired on 192.168.18.22; the PC has since moved to another network.
      final harness = await build(echo, hosts: const ['192.168.18.22:19850']);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);
      harness.selector.directReachable = true;

      // The replica stored where the PC listens now, then told the session.
      await harness.repo.recordHosts('mac-1', const ['192.168.100.140:19850']);
      harness.coordinator.handlePcAddressesChanged('mac-1');
      await _until(
        () => harness.coordinator.connectedRoute == ConnectionRoute.lan,
      );

      expect(
        harness.selector.directAsked.single.hosts,
        ['192.168.100.140:19850'],
      );
      expect(
        harness.coordinator.connectedEndpoint,
        'ws://192.168.100.140:19850',
      );
      expect(harness.coordinator.connectedDevice?.hosts, [
        '192.168.100.140:19850',
      ]);
      expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    });

    test('a burst of address changes is one try', () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);

      for (var i = 0; i < 5; i++) {
        harness.coordinator.handlePcAddressesChanged('mac-1');
      }
      await Future<void>.delayed(const Duration(milliseconds: 60));

      expect(harness.selector.directDials, 1);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);
    });

    test("another PC's addresses, or a direct session, ask for no try",
        () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);

      harness.coordinator.handlePcAddressesChanged('mac-2');
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(harness.selector.directDials, 0);

      final direct = await build(echo, relay: null, hosts: const [lanHost]);
      addTearDown(direct.coordinator.dispose);
      await direct.coordinator.connect(forceQrBootstrap: true);
      expect(direct.coordinator.connectedRoute, ConnectionRoute.lan);
      direct.coordinator.handlePcAddressesChanged('mac-1');
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(direct.selector.directDials, 0);
    });

    test('a flapping network never stacks tries: one in flight, one after',
        () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);
      final gate = Completer<void>();
      harness.selector.directGate = gate;

      final first = harness.coordinator.handleNetworkChange();
      await Future<void>.delayed(Duration.zero);
      final more = [
        for (var i = 0; i < 4; i++) harness.coordinator.handleNetworkChange(),
      ];
      harness.coordinator.handlePcAddressesChanged('mac-1');
      await Future.wait(more);
      expect(harness.selector.directDials, 1, reason: 'one try in flight');

      gate.complete();
      await first;
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(harness.selector.directDials, 2, reason: 'and one after it');
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);
      expect(harness.coordinator.connectionPhase, ConnectionPhase.connected);
    });

    test(
        'a failed try keeps the relay session, and says why when the PC was '
        'seen on this network', () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);
      expect(harness.coordinator.relayReason, isNull);
      harness.selector.relayReason = RelayReason.sameNetworkUnreachable;

      await harness.coordinator.handleNetworkChange();

      expect(
        harness.coordinator.relayReason,
        RelayReason.sameNetworkUnreachable,
      );
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);
      final response = await harness.coordinator
          .sendRequest('ping')
          .timeout(const Duration(seconds: 5));
      expect((response.result! as Map)['echo'], 'ping');

      // Away from that network the PC is not seen: nothing to say.
      harness.selector.relayReason = null;
      await harness.coordinator.handleNetworkChange();
      expect(harness.coordinator.relayReason, isNull);

      // Seen again, and then reached: a direct route has no relay reason.
      harness.selector.relayReason = RelayReason.sameNetworkUnreachable;
      await harness.coordinator.handleNetworkChange();
      harness.selector.directReachable = true;
      await harness.coordinator.handleNetworkChange();
      await pumpEventQueue();
      expect(harness.coordinator.connectedRoute, ConnectionRoute.lan);
      expect(harness.coordinator.relayReason, isNull);
    });

    test('connecting through the relay says why when the PC was seen nearby',
        () async {
      final harness = await build(echo, hosts: const [lanHost]);
      addTearDown(harness.coordinator.dispose);
      harness.selector.relayReason = RelayReason.sameNetworkUnreachable;

      await harness.coordinator.connect(forceQrBootstrap: true);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);
      expect(
        harness.coordinator.relayReason,
        RelayReason.sameNetworkUnreachable,
      );

      await harness.coordinator.disconnect();
      expect(harness.coordinator.relayReason, isNull);
    });

    test('a PC with no direct hosts is never dialed directly', () async {
      final harness = await build(echo);
      addTearDown(harness.coordinator.dispose);
      await harness.coordinator.connect(forceQrBootstrap: true);
      harness.selector.directReachable = true;

      await harness.coordinator.handleNetworkChange();

      expect(harness.selector.directDials, 0);
      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);
    });
  });

  group('nothing on the network keeps the phone off its relay', () {
    const dead = '192.168.18.22';
    const spoof = '192.168.100.66';
    const pcIp = '192.168.100.140';

    Future<
        ({
          SessionCoordinator coordinator,
          _Lan lan,
          List<Duration> waits,
        })> onLan({
      required List<String> stored,
      Set<String> pcHosts = const {},
      Set<String> spoofHosts = const {},
      List<String> announced = const [],
      RelayEndpoint? relay = _relay,
      int maxReconnectAttempts = 10,
    }) async {
      final pc = await keygen.generateIdentityKeyPair();
      final spoofer = await keygen.generateIdentityKeyPair();
      final phoneKeys = await keygen.generateIdentityKeyPair();
      final phone = PhoneIdentity(
        phoneDeviceId: 'phone-1',
        publicKey: phoneKeys.publicKey,
        privateSeed: phoneKeys.privateSeed,
      );
      final lan = _Lan(
        pc: pc,
        spoofer: spoofer,
        handler: echo,
        pcHosts: pcHosts,
        spoofHosts: spoofHosts,
      );
      final waits = <Duration>[];
      final coordinator = SessionCoordinator(
        secureTransport: SecureTransportLayer(),
        transportSelector: DirectTransportSelector(
          () => _LanTransport(lan),
          relayClient: RelayClient(
            createTransport: () => _LanTransport(lan),
            identity: () async => phone,
          ),
          lanFinder: _Announced(announced),
          onLocalNetwork: () async => true,
          directTimeout: const Duration(milliseconds: 200),
          mdnsWindow: const Duration(milliseconds: 50),
        ),
        identityResolver: () async => phone,
        delay: (wait) async => waits.add(wait),
        maxReconnectAttempts: maxReconnectAttempts,
      )..setActiveDevice(
          TrustedDevice(
            macDeviceId: 'mac-1',
            displayName: 'Test Bridge',
            macIdentityPublicKey: pc.publicKey,
            relay: relay,
            hosts: [for (final h in stored) '$h:19850'],
            sessionId: 'session-xyz',
            pairedAt: DateTime(2026),
          ),
        );
      return (coordinator: coordinator, lan: lan, waits: waits);
    }

    test(
        'an announced peer that fails the handshake: the relay, in the same '
        'attempt', () async {
      final harness = await onLan(
        stored: const [dead],
        spoofHosts: const {'$spoof:19850'},
        announced: const [spoof],
      );
      addTearDown(harness.coordinator.dispose);

      await harness.coordinator.connect();

      expect(harness.coordinator.connectedRoute, ConnectionRoute.relay);
      expect(
        harness.coordinator.relayReason,
        RelayReason.directHandshakeFailed,
      );
      expect(harness.lan.dialsTo(spoof), 1, reason: 'skipped, not retried');
      expect(harness.lan.dials.last, _relayPhoneUrl);
      final response = await harness.coordinator
          .sendRequest('ping')
          .timeout(const Duration(seconds: 5));
      expect((response.result! as Map)['echo'], 'ping');
    });

    test('a stored host that fails the handshake gives way to the next one',
        () async {
      final harness = await onLan(
        stored: const [spoof, pcIp],
        spoofHosts: const {'$spoof:19850'},
        pcHosts: const {'$pcIp:19850'},
      );
      addTearDown(harness.coordinator.dispose);

      await harness.coordinator.connect();

      expect(harness.coordinator.connectedRoute, ConnectionRoute.lan);
      expect(harness.coordinator.connectedEndpoint, 'ws://$pcIp:19850');
      expect(harness.coordinator.relayReason, isNull);
      expect(harness.lan.dials, isNot(contains(_relayPhoneUrl)));
      final response = await harness.coordinator
          .sendRequest('ping')
          .timeout(const Duration(seconds: 5));
      expect((response.result! as Map)['echo'], 'ping');
    });

    test(
        'no relay and a spoofed peer: the typed error, then the usual backoff '
        '— never a retry storm', () async {
      final harness = await onLan(
        stored: const [dead],
        spoofHosts: const {'$spoof:19850'},
        announced: const [spoof],
        relay: null,
        maxReconnectAttempts: 3,
      );
      addTearDown(harness.coordinator.dispose);

      await expectLater(
        harness.coordinator.connect(),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.handshake,
          ),
        ),
      );
      expect(harness.lan.dialsTo(spoof), 1);

      await harness.coordinator.handleReconnect();

      // One dial of the spoofer per attempt, each after its backoff wait.
      expect(harness.waits, hasLength(3));
      expect(harness.lan.dialsTo(spoof), 1 + 3);
      expect(harness.coordinator.connectionPhase, ConnectionPhase.error);
      final recovery = await harness.coordinator.recoveryStateStream.first;
      expect(recovery.requiresManualIntervention, isTrue);
      expect(recovery.lastTransportFailure, TransportErrorKind.handshake);
    });
  });

  test('the reconnect loop says when the PC has no route from here', () async {
    final harness = await build(echo);
    addTearDown(harness.coordinator.dispose);
    await harness.coordinator.connect(forceQrBootstrap: true);

    final states = <ConnectionRecoveryState>[];
    final sub = harness.coordinator.recoveryStateStream.listen(states.add);
    addTearDown(sub.cancel);
    harness.selector.failNext.add(
      const TransportException(TransportErrorKind.noRoute, 'no route'),
    );
    await harness.selector.dropCurrent();
    await harness.coordinator.connectionPhaseStream
        .firstWhere((p) => p == ConnectionPhase.connected)
        .timeout(const Duration(seconds: 5));
    await pumpEventQueue();

    expect(
      states
          .where((s) => s.attempt == 2 && s.isRecovering)
          .first
          .lastTransportFailure,
      TransportErrorKind.noRoute,
    );
    // Back online: nothing to explain any more.
    expect(states.last.lastTransportFailure, isNull);
  });
}

Future<void> _until(bool Function() condition) async {
  for (var i = 0; i < 200 && !condition(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
  expect(condition(), isTrue);
}
