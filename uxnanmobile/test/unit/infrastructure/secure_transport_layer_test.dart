import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:async/async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/secure_session.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';
import 'package:uxnan/infrastructure/crypto/handshake_crypto.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
import 'package:uxnan/infrastructure/transport/secure_transport_layer.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// In-memory [WebSocketTransport] whose [send] delivers to its [peer].
class _InMemoryTransport implements WebSocketTransport {
  final StreamController<Uint8List> _incoming =
      StreamController<Uint8List>.broadcast();
  late _InMemoryTransport peer;

  @override
  String? connectedUrl;

  @override
  Stream<Uint8List> get incoming => _incoming.stream;

  @override
  Stream<TransportState> get stateChanges => const Stream.empty();

  @override
  Future<void> connect(String url, {Map<String, String>? headers}) async {
    connectedUrl = url;
  }

  @override
  Future<void> disconnect() async {
    await _incoming.close();
  }

  @override
  Future<void> send(Uint8List data) async {
    peer._incoming.add(data);
  }
}

({_InMemoryTransport phone, _InMemoryTransport bridge}) _pair() {
  final phone = _InMemoryTransport();
  final bridge = _InMemoryTransport();
  phone.peer = bridge;
  bridge.peer = phone;
  return (phone: phone, bridge: bridge);
}

/// Minimal bridge-side handshake responder; returns the bridge's derived key.
Future<Uint8List> _runBridge(
  _InMemoryTransport transport, {
  required Ed25519KeyPairBytes bridgeIdentity,
  required String macDeviceId,
  required int expiresAtForTranscript,
}) async {
  final crypto = HandshakeCrypto();
  final keygen = KeyGeneration();
  final queue = StreamQueue<Uint8List>(transport.incoming);
  try {
    final hello =
        jsonDecode(utf8.decode(await queue.next)) as Map<String, dynamic>;
    final clientNonce = (hello['clientNonce'] as String).fromHex();
    final phoneEphPub = (hello['phoneEphemeralPublicKey'] as String).fromHex();
    final phoneIdPub = (hello['phoneIdentityPublicKey'] as String).fromHex();
    final sessionId = hello['sessionId'] as String;

    final bridgeEph = await keygen.generateEphemeralKeyPair();
    final serverNonce = keygen.randomBytes(32);
    const keyEpoch = 1;

    final transcript = crypto.buildTranscript(
      HandshakeTranscriptInput(
        clientNonce: clientNonce,
        phoneEphemeralPublicKey: phoneEphPub,
        macEphemeralPublicKey: bridgeEph.publicKey,
        serverNonce: serverNonce,
        sessionId: sessionId,
        keyEpoch: keyEpoch,
        expiresAtForTranscript: expiresAtForTranscript,
      ),
    );
    final macSignature =
        await crypto.sign(transcript, bridgeIdentity.privateSeed);

    await transport.send(
      Uint8List.fromList(
        utf8.encode(
          jsonEncode({
            'kind': 'serverHello',
            'protocolVersion': 1,
            'sessionId': sessionId,
            'macDeviceId': macDeviceId,
            'macIdentityPublicKey': bridgeIdentity.publicKey.toHex(),
            'macEphemeralPublicKey': bridgeEph.publicKey.toHex(),
            'serverNonce': serverNonce.toHex(),
            'keyEpoch': keyEpoch,
            'expiresAtForTranscript': expiresAtForTranscript,
            'macSignature': macSignature.toHex(),
            'clientNonce': clientNonce.toHex(),
            'displayName': 'Test Bridge',
          }),
        ),
      ),
    );

    final auth =
        jsonDecode(utf8.decode(await queue.next)) as Map<String, dynamic>;
    final phoneSignature = (auth['phoneSignature'] as String).fromHex();
    final phoneOk = await crypto.verify(transcript, phoneSignature, phoneIdPub);
    expect(phoneOk, isTrue, reason: 'bridge must verify the phone signature');

    await transport.send(
      Uint8List.fromList(
        utf8.encode(
          jsonEncode({
            'kind': 'ready',
            'sessionId': sessionId,
            'keyEpoch': keyEpoch,
            'macDeviceId': macDeviceId,
          }),
        ),
      ),
    );

    return crypto.deriveSessionKey(
      phoneEphemeralPrivateKey: bridgeEph.privateKey,
      macEphemeralPublicKey: phoneEphPub,
      clientNonce: clientNonce,
      serverNonce: serverNonce,
    );
  } finally {
    await queue.cancel(immediate: true);
  }
}

void main() {
  final keygen = KeyGeneration();
  final layer = SecureTransportLayer();

  Future<PhoneIdentity> phoneIdentity() async {
    final id = await keygen.generateIdentityKeyPair();
    return PhoneIdentity(
      phoneDeviceId: 'phone-1',
      publicKey: id.publicKey,
      privateSeed: id.privateSeed,
    );
  }

  TrustedDevice device(Uint8List macIdentityPublicKey) => TrustedDevice(
        macDeviceId: 'mac-1',
        displayName: 'Test Bridge',
        macIdentityPublicKey: macIdentityPublicKey,
        relayUrl: 'wss://relay.test',
        sessionId: 'session-xyz',
        pairedAt: DateTime(2026),
      );

  group('performHandshake', () {
    test('phone and bridge derive the same session key', () async {
      final transports = _pair();
      final bridgeId = await keygen.generateIdentityKeyPair();
      final phone = await phoneIdentity();
      final expiresAt =
          DateTime(2030).millisecondsSinceEpoch; // comfortably in the future

      final bridgeFuture = _runBridge(
        transports.bridge,
        bridgeIdentity: bridgeId,
        macDeviceId: 'mac-1',
        expiresAtForTranscript: expiresAt,
      );
      final session = await layer.performHandshake(
        transport: transports.phone,
        phoneIdentity: phone,
        device: device(bridgeId.publicKey),
        mode: HandshakeMode.qrBootstrap,
      );
      final bridgeKey = await bridgeFuture;

      expect(session.derivedKey.length, 32);
      expect(session.derivedKey, bridgeKey);
      expect(session.sessionId, 'session-xyz');
      expect(session.macDeviceId, 'mac-1');
      expect(session.phoneOutboundSeq, 1);
    });

    test('rejects a bridge whose identity key is not trusted', () async {
      final transports = _pair();
      final bridgeId = await keygen.generateIdentityKeyPair();
      final attackerId = await keygen.generateIdentityKeyPair();
      final phone = await phoneIdentity();

      unawaited(
        _runBridge(
          transports.bridge,
          bridgeIdentity: bridgeId,
          macDeviceId: 'mac-1',
          expiresAtForTranscript: DateTime(2030).millisecondsSinceEpoch,
        ).catchError((_) => Uint8List(0)),
      );

      await expectLater(
        layer.performHandshake(
          transport: transports.phone,
          phoneIdentity: phone,
          // Trust a different identity than the bridge actually uses.
          device: device(attackerId.publicKey),
          mode: HandshakeMode.qrBootstrap,
        ),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.handshake,
          ),
        ),
      );
    });
  });

  group('SecureChannel', () {
    SecureSession session() => SecureSession(
          sessionId: 's',
          macDeviceId: 'mac-1',
          phoneDeviceId: 'phone-1',
          derivedKey: keygen.randomBytes(32),
          keyEpoch: 1,
          mode: HandshakeMode.qrBootstrap,
        );

    test('encrypts and decrypts across two channels', () async {
      final shared = session();
      // sender = phone (default role): tags AAD direction phone->bridge.
      // receiver = bridge role: expects that same phone->bridge direction on
      // decrypt (architecture/02a §5.9.1 direction binding).
      final sender = SecureChannel(shared);
      final receiver = SecureChannel(shared, role: SecureChannelRole.bridge);

      final plaintext = Uint8List.fromList(utf8.encode('turn/send payload'));
      final envelope = await sender.encrypt(plaintext);
      expect(envelope.seq, 1);

      final decrypted = await receiver.decrypt(envelope);
      expect(decrypted, plaintext);
    });

    test('rejects a replayed envelope', () async {
      final shared = session();
      final sender = SecureChannel(shared);
      final receiver = SecureChannel(shared, role: SecureChannelRole.bridge);

      final e1 = await sender.encrypt(Uint8List.fromList([1, 2, 3]));
      final e2 = await sender.encrypt(Uint8List.fromList([4, 5, 6]));
      expect(e1.seq, 1);
      expect(e2.seq, 2);

      await receiver.decrypt(e1);
      await receiver.decrypt(e2);

      // Re-delivering e1 (and e2) must be rejected as replays.
      await expectLater(
        receiver.decrypt(e1),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.replay,
          ),
        ),
      );
    });

    test('concurrent encrypts get unique contiguous seqs', () async {
      // Regression: two RPCs fired concurrently (e.g. project/list + agent/list)
      // must not read the same phoneOutboundSeq and emit a duplicate seq, which
      // the bridge rejects as a replay.
      final sender = SecureChannel(session());
      final envelopes = await Future.wait(
        List.generate(
          20,
          (i) => sender.encrypt(Uint8List.fromList([i])),
        ),
      );
      final seqs = envelopes.map((e) => e.seq).toList()..sort();
      expect(seqs.toSet().length, 20, reason: 'all seqs must be unique');
      expect(seqs, List<int>.generate(20, (i) => i + 1));
    });

    test('buildEnvelopeAad matches the canonical byte layout for the '
        'reference vector', () {
      // sessionId="abc", seq=1, direction=phone->bridge (0x01):
      //   "abc" = 61 62 63; sep 00; u64_be(1) = 00*7 01; sep 00; direction 01.
      final aad = buildEnvelopeAad('abc', 1, directionPhoneToBridge);
      expect(aad.length, 14);
      expect(
        aad,
        Uint8List.fromList(
          [0x61, 0x62, 0x63, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01],
        ),
      );
      expect(aad.toHex(), '6162630000000000000000010001');
    });

    test(
        'a phone-outbound envelope fed back as inbound (direction reflection) '
        'fails decryption', () async {
      final shared = session();
      // Two independent 'phone'-role channels sharing the same session/key
      // (the default role): channelA's encrypt() tags AAD direction
      // phone->bridge; channelB's decrypt() (same default role) expects
      // INBOUND direction bridge->phone. A malicious relay reflecting
      // channelA's own outbound envelope back as if it were inbound bridge
      // traffic must not be accepted.
      final channelA = SecureChannel(shared);
      final channelB = SecureChannel(shared);
      final envelope =
          await channelA.encrypt(Uint8List.fromList(utf8.encode('reflect me')));
      await expectLater(
        channelB.decrypt(envelope),
        throwsA(
          isA<TransportException>().having(
            (e) => e.kind,
            'kind',
            TransportErrorKind.decryption,
          ),
        ),
      );
    });
  });

  group('classifyRaw', () {
    Uint8List bytes(Object json) =>
        Uint8List.fromList(utf8.encode(jsonEncode(json)));

    test('classifies handshake, envelope, rpc and unknown frames', () {
      expect(
        layer.classifyRaw(bytes({'kind': 'serverHello'})),
        SecureMessageKind.handshake,
      );
      expect(
        layer.classifyRaw(bytes({'kind': 'encryptedEnvelope'})),
        SecureMessageKind.envelope,
      );
      expect(
        layer.classifyRaw(bytes({'jsonrpc': '2.0', 'id': '1'})),
        SecureMessageKind.rpc,
      );
      expect(
        layer.classifyRaw(Uint8List.fromList([0, 1, 2, 3])),
        SecureMessageKind.unknown,
      );
    });
  });
}
