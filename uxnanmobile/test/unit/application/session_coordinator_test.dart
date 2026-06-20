import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:async/async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/coordinators/session_coordinator.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/secure_session.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';
import 'package:uxnan/domain/repositories/i_trusted_device_repository.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/secure_envelope.dart';
import 'package:uxnan/infrastructure/crypto/handshake_crypto.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
import 'package:uxnan/infrastructure/transport/secure_transport_layer.dart';
import 'package:uxnan/infrastructure/transport/transport_selector.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

class _InMemoryTransport implements WebSocketTransport {
  final StreamController<Uint8List> incomingController =
      StreamController<Uint8List>.broadcast();
  late _InMemoryTransport peer;

  @override
  Stream<Uint8List> get incoming => incomingController.stream;

  @override
  Stream<TransportState> get stateChanges => const Stream.empty();

  @override
  Future<void> connect(String url, {Map<String, String>? headers}) async {}

  @override
  Future<void> disconnect() async => forceClose();

  @override
  Future<void> send(Uint8List data) async {
    if (!peer.incomingController.isClosed) peer.incomingController.add(data);
  }

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
  _FakeBridge(this.transport, this.identity, this.handler);

  final _InMemoryTransport transport;
  final Ed25519KeyPairBytes identity;
  final RpcMessage Function(RpcMessage request) handler;

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
          'protocolVersion': 1,
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
      final channel = SecureChannel(
        SecureSession(
          sessionId: sessionId,
          macDeviceId: 'mac-1',
          phoneDeviceId: 'phone-1',
          derivedKey: key,
          keyEpoch: keyEpoch,
          mode: HandshakeMode.qrBootstrap,
        ),
      );
      _channel = channel;

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

class _FakeSelector implements TransportSelector {
  _FakeSelector(this.identity, this.handler);

  final Ed25519KeyPairBytes identity;
  final RpcMessage Function(RpcMessage request) handler;
  final List<_InMemoryTransport> phoneSides = [];
  _FakeBridge? currentBridge;

  /// Device ids the selector should treat as unreachable (throws on select).
  final Set<String> unreachable = {};

  @override
  Future<WebSocketTransport> select(TrustedDevice device) async {
    if (unreachable.contains(device.macDeviceId)) {
      throw StateError('unreachable: ${device.macDeviceId}');
    }
    final phone = _InMemoryTransport();
    final bridge = _InMemoryTransport();
    phone.peer = bridge;
    bridge.peer = phone;
    phoneSides.add(phone);
    final fakeBridge = _FakeBridge(bridge, identity, handler);
    currentBridge = fakeBridge;
    unawaited(fakeBridge.run());
    return phone;
  }

  Future<void> dropCurrent() async {
    await phoneSides.last.forceClose();
    await phoneSides.last.peer.forceClose();
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
      })> build(
    RpcMessage Function(RpcMessage) handler, {
    bool setActive = true,
    DelayFn? delay,
  }) async {
    bridgeId = await keygen.generateIdentityKeyPair();
    final phoneId = await keygen.generateIdentityKeyPair();
    final selector = _FakeSelector(bridgeId, handler);
    final repo = _FakeTrustedDeviceRepo();
    final coordinator = SessionCoordinator(
      secureTransport: SecureTransportLayer(),
      transportSelector: selector,
      trustedDeviceRepository: repo,
      identityResolver: () async => PhoneIdentity(
        phoneDeviceId: 'phone-1',
        publicKey: phoneId.publicKey,
        privateSeed: phoneId.privateSeed,
      ),
      delay: delay ?? (_) async {}, // elide backoff in tests by default
    );
    if (setActive) {
      coordinator.setActiveDevice(
        TrustedDevice(
          macDeviceId: 'mac-1',
          displayName: 'Test Bridge',
          macIdentityPublicKey: bridgeId.publicKey,
          relayUrl: 'wss://relay.test',
          sessionId: 'session-xyz',
          pairedAt: DateTime(2026),
        ),
      );
    }
    return (coordinator: coordinator, selector: selector, repo: repo);
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
      relayUrl: 'wss://relay.test',
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

    // Drop → the reconnect loop enters and parks on the (never-completing) delay.
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

    expect((response.result as Map)['echo'], 'turn/send');
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
        relayUrl: 'wss://relay.test',
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
        relayUrl: 'wss://relay.test',
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
      version: 2,
      relayUrl: 'wss://relay.test',
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
  });
}
