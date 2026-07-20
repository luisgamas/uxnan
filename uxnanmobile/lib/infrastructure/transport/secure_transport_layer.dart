import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:async/async.dart';
import 'package:uxnan/core/constants/protocol_constants.dart';
import 'package:uxnan/core/errors/transport_exception.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/entities/secure_session.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';
import 'package:uxnan/domain/value_objects/secure_envelope.dart';
import 'package:uxnan/infrastructure/crypto/envelope_crypto.dart';
import 'package:uxnan/infrastructure/crypto/handshake_crypto.dart';
import 'package:uxnan/infrastructure/crypto/key_generation.dart';
import 'package:uxnan/infrastructure/transport/handshake_messages.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// AAD direction byte: an envelope travelling phone → bridge. Mirrors the
/// canonical value in `shared/src/constants.ts` via [ProtocolConstants].
const int directionPhoneToBridge =
    ProtocolConstants.envelopeDirectionPhoneToBridge;

/// AAD direction byte: an envelope travelling bridge → phone.
const int directionBridgeToPhone =
    ProtocolConstants.envelopeDirectionBridgeToPhone;

/// Which physical side a [SecureChannel] instance represents, for AAD
/// direction binding. Real app code always uses the default [phone] role
/// (this class is the phone-side implementation); [bridge] exists only so
/// tests can drive an independent, direction-correct stand-in for the bridge
/// side without a second implementation of the channel.
enum SecureChannelRole { phone, bridge }

/// Build the canonical AES-GCM AAD binding `sessionId`, `seq` and the sending
/// `direction` to the tag (architecture/02a §5.9.1):
///
///   AAD = utf8(sessionId) || 0x00 || u64_be(seq) || 0x00 || direction
///
/// Both peers must derive byte-identical AAD for a given
/// `(sessionId, seq, direction)` — the bridge's
/// `secure-channel.ts` `buildEnvelopeAad` mirrors this exactly (UTF-8
/// sessionId, big-endian u64 seq, the same `0x00` separators).
Uint8List buildEnvelopeAad(String sessionId, int seq, int direction) {
  final sessionIdBytes = utf8.encode(sessionId);
  // Endian.big is `setUint64`'s default, but this is a byte-level contract with
  // the bridge — state it rather than inherit it.
  // ignore: avoid_redundant_argument_values
  final seqBytes = ByteData(8)..setUint64(0, seq, Endian.big);
  return Uint8List.fromList(<int>[
    ...sessionIdBytes,
    0x00,
    ...seqBytes.buffer.asUint8List(),
    0x00,
    direction,
  ]);
}

/// Coarse classification of an inbound raw frame.
enum SecureMessageKind {
  /// A handshake control message.
  handshake,

  /// An encrypted envelope carrying application traffic.
  envelope,

  /// A plaintext JSON-RPC message (rare; mostly enveloped).
  rpc,

  /// Anything that could not be classified.
  unknown,
}

/// Performs the E2EE handshake and opens encrypted [SecureChannel]s.
///
/// Implements the phone side of the protocol in
/// `architecture/02a-system-architecture.md` (section 5.9.1), reusing the
/// audited primitives in `infrastructure/crypto/`. No cryptographic variants
/// are introduced here.
class SecureTransportLayer {
  /// Creates a [SecureTransportLayer], optionally injecting crypto helpers.
  SecureTransportLayer({
    KeyGeneration? keyGeneration,
    HandshakeCrypto? handshakeCrypto,
    EnvelopeCrypto? envelopeCrypto,
  })  : _keyGen = keyGeneration ?? KeyGeneration(),
        _handshake = handshakeCrypto ?? HandshakeCrypto(),
        _envelope = envelopeCrypto ?? EnvelopeCrypto();

  final KeyGeneration _keyGen;
  final HandshakeCrypto _handshake;
  final EnvelopeCrypto _envelope;

  /// Runs the full handshake over [transport] and returns the [SecureSession].
  ///
  /// Throws a [TransportException] of kind [TransportErrorKind.handshake] if
  /// any verification step fails (nonce echo, expiry, identity, signature) or
  /// if the bridge does not respond within [stepTimeout] per handshake step.
  Future<SecureSession> performHandshake({
    required WebSocketTransport transport,
    required PhoneIdentity phoneIdentity,
    required TrustedDevice device,
    required HandshakeMode mode,
    int lastAppliedBridgeOutboundSeq = 0,
    Duration stepTimeout = const Duration(seconds: 15),
  }) async {
    final ephemeral = await _keyGen.generateEphemeralKeyPair();
    final clientNonce = _keyGen.randomBytes(32);
    final queue = StreamQueue<Uint8List>(transport.incoming);

    try {
      await _sendJson(
        transport,
        ClientHello(
          sessionId: device.sessionId,
          handshakeMode: mode,
          phoneDeviceId: phoneIdentity.phoneDeviceId,
          phoneIdentityPublicKey: phoneIdentity.publicKey,
          phoneEphemeralPublicKey: ephemeral.publicKey,
          clientNonce: clientNonce,
          lastAppliedBridgeOutboundSeq: lastAppliedBridgeOutboundSeq,
        ).toJson(),
      );

      final serverHello = ServerHello.fromJson(
        await _nextJson(queue).timeout(stepTimeout),
      );
      _verifyServerHello(serverHello, clientNonce, device, mode);

      final transcript = _handshake.buildTranscript(
        HandshakeTranscriptInput(
          clientNonce: clientNonce,
          phoneEphemeralPublicKey: ephemeral.publicKey,
          macEphemeralPublicKey: serverHello.macEphemeralPublicKey,
          serverNonce: serverHello.serverNonce,
          sessionId: device.sessionId,
          keyEpoch: serverHello.keyEpoch,
          expiresAtForTranscript: serverHello.expiresAtForTranscript,
        ),
      );

      final signatureOk = await _handshake.verify(
        transcript,
        serverHello.macSignature,
        device.macIdentityPublicKey,
      );
      if (!signatureOk) {
        throw const TransportException(
          TransportErrorKind.handshake,
          'Bridge signature verification failed',
        );
      }

      final derivedKey = await _handshake.deriveSessionKey(
        phoneEphemeralPrivateKey: ephemeral.privateKey,
        macEphemeralPublicKey: serverHello.macEphemeralPublicKey,
        clientNonce: clientNonce,
        serverNonce: serverHello.serverNonce,
      );

      final phoneSignature = await _handshake.sign(
        transcript,
        phoneIdentity.privateSeed,
      );
      await _sendJson(
        transport,
        ClientAuth(
          sessionId: device.sessionId,
          phoneDeviceId: phoneIdentity.phoneDeviceId,
          keyEpoch: serverHello.keyEpoch,
          phoneSignature: phoneSignature,
        ).toJson(),
      );

      final ready = Ready.fromJson(
        await _nextJson(queue).timeout(stepTimeout),
      );
      if (ready.sessionId != device.sessionId) {
        throw const TransportException(
          TransportErrorKind.handshake,
          'Ready sessionId mismatch',
        );
      }

      return SecureSession(
        sessionId: device.sessionId,
        macDeviceId: device.macDeviceId,
        phoneDeviceId: phoneIdentity.phoneDeviceId,
        derivedKey: derivedKey,
        keyEpoch: serverHello.keyEpoch,
        mode: mode,
      );
    } finally {
      await queue.cancel(immediate: true);
    }
  }

  /// Opens an encrypted channel over an established [session].
  SecureChannel openChannel(SecureSession session) =>
      SecureChannel(session, envelopeCrypto: _envelope);

  /// Classifies a raw inbound frame without decrypting it.
  SecureMessageKind classifyRaw(Uint8List data) {
    try {
      final decoded = jsonDecode(utf8.decode(data));
      if (decoded is! Map) return SecureMessageKind.unknown;
      final kind = decoded['kind'];
      if (kind == SecureEnvelope.kind) return SecureMessageKind.envelope;
      if (kind == ServerHello.kind ||
          kind == Ready.kind ||
          kind == ClientHello.kind ||
          kind == ClientAuth.kind) {
        return SecureMessageKind.handshake;
      }
      if (decoded['jsonrpc'] != null) return SecureMessageKind.rpc;
      return SecureMessageKind.unknown;
    } on FormatException {
      return SecureMessageKind.unknown;
    }
  }

  void _verifyServerHello(
    ServerHello hello,
    Uint8List clientNonce,
    TrustedDevice device,
    HandshakeMode mode,
  ) {
    // Reject a protocol gap while both sides can still read each other's JSON.
    // Past the handshake every frame is AEAD-sealed with a version-specific
    // AAD, so a mismatch would look like "connected, but nothing ever works".
    if (hello.protocolVersion != ProtocolConstants.secureProtocolVersion) {
      throw TransportException(
        TransportErrorKind.handshake,
        'Incompatible bridge: it speaks secure protocol '
        'v${hello.protocolVersion}, this app speaks '
        'v${ProtocolConstants.secureProtocolVersion}. Update the '
        'bridge and the app to matching versions.',
      );
    }
    if (!_bytesEqual(hello.clientNonce, clientNonce)) {
      throw const TransportException(
        TransportErrorKind.handshake,
        'Server did not echo the client nonce',
      );
    }
    if (!_bytesEqual(hello.macIdentityPublicKey, device.macIdentityPublicKey)) {
      throw const TransportException(
        TransportErrorKind.handshake,
        'Bridge identity key does not match the trusted device',
      );
    }
    final skew = mode == HandshakeMode.trustedReconnect
        ? ProtocolConstants.trustedReconnectSkew
        : ProtocolConstants.clockSkewTolerance;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    if (nowMs > hello.expiresAtForTranscript + skew.inMilliseconds) {
      throw const TransportException(
        TransportErrorKind.handshake,
        'Handshake transcript has expired',
      );
    }
  }

  Future<void> _sendJson(
    WebSocketTransport transport,
    Map<String, dynamic> json,
  ) {
    return transport.send(Uint8List.fromList(utf8.encode(jsonEncode(json))));
  }

  Future<Map<String, dynamic>> _nextJson(StreamQueue<Uint8List> queue) async {
    final raw = await queue.next;
    return jsonDecode(utf8.decode(raw)) as Map<String, dynamic>;
  }

  static bool _bytesEqual(Uint8List a, Uint8List b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

/// An encrypted message channel over an established [SecureSession].
///
/// Encrypts outbound plaintext into [SecureEnvelope]s with a monotonic phone
/// sequence number, and decrypts inbound envelopes while enforcing replay
/// protection: any envelope whose `seq` is not strictly greater than the last
/// applied bridge sequence is rejected (spec 02b §5.3).
class SecureChannel {
  /// Creates a [SecureChannel] over [session].
  SecureChannel(
    this._session, {
    EnvelopeCrypto? envelopeCrypto,
    SecureChannelRole role = SecureChannelRole.phone,
  })  : _envelope = envelopeCrypto ?? EnvelopeCrypto(),
        _lastInboundSeq = _session.bridgeOutboundSeq,
        _outboundDirection = role == SecureChannelRole.phone
            ? directionPhoneToBridge
            : directionBridgeToPhone,
        _inboundDirection = role == SecureChannelRole.phone
            ? directionBridgeToPhone
            : directionPhoneToBridge;

  SecureSession _session;
  final EnvelopeCrypto _envelope;
  int _lastInboundSeq;

  /// AAD direction this instance uses when it encrypts (sends).
  final int _outboundDirection;

  /// AAD direction this instance expects on the envelopes it decrypts
  /// (receives).
  final int _inboundDirection;

  /// The current session (sequence counters advance as traffic flows).
  SecureSession get session => _session;

  /// Encrypts [plaintext] into the next outbound envelope.
  ///
  /// The sequence number is reserved **synchronously** (before the `await` on
  /// the encryption) so concurrent `encrypt` calls can never read the same
  /// `phoneOutboundSeq` and emit a duplicate seq, which the bridge rejects as a
  /// replay. The caller (the session coordinator) also serializes sends so
  /// envelopes reach the bridge in seq order.
  Future<SecureEnvelope> encrypt(Uint8List plaintext) async {
    final session = _session;
    final seq = session.phoneOutboundSeq;
    _session = session.withPhoneSeq(seq + 1);
    final aad = buildEnvelopeAad(session.sessionId, seq, _outboundDirection);
    return _envelope.encrypt(
      plaintext: plaintext,
      key: session.derivedKey,
      sessionId: session.sessionId,
      seq: seq,
      aad: aad,
    );
  }

  /// Decrypts an inbound [envelope], enforcing session and replay checks.
  Future<Uint8List> decrypt(SecureEnvelope envelope) async {
    if (envelope.sessionId != _session.sessionId) {
      throw const TransportException(
        TransportErrorKind.decryption,
        'Envelope sessionId mismatch',
      );
    }
    if (envelope.seq <= _lastInboundSeq) {
      throw TransportException(
        TransportErrorKind.replay,
        'Envelope seq ${envelope.seq} <= last applied $_lastInboundSeq',
      );
    }
    final aad = buildEnvelopeAad(
      envelope.sessionId,
      envelope.seq,
      _inboundDirection,
    );
    final plaintext = await _envelope.decrypt(
      envelope: envelope,
      key: _session.derivedKey,
      aad: aad,
    );
    _lastInboundSeq = envelope.seq;
    _session = _session.withBridgeSeq(envelope.seq);
    return plaintext;
  }
}
