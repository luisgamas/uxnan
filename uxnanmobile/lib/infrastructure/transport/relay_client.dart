import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:async/async.dart';
import 'package:uxnan/core/errors/relay_exception.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/entities/phone_identity.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
import 'package:uxnan/infrastructure/crypto/handshake_crypto.dart';
import 'package:uxnan/infrastructure/transport/relay_protocol.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// Opens a phone's connection through the user's own relay
/// (architecture/02a §5.10; the server side is `relay/src/room.ts`).
///
/// 1. Dials `<url>/v1/connect/<routingId>`.
/// 2. Reads the relay's `challenge` and answers `phone-auth`: the phone's
///    Ed25519 identity public key and its signature, with that same identity
///    key (the one the E2EE handshake's `clientAuth` uses), over
///    [RelayProtocol.phoneSigningMessage] — plus the QR's one-time `ticket`
///    when pairing through the relay for the first time.
/// 3. Waits for `ready`, sent once the bridge has opened this phone's
///    channel.
///
/// It then hands back the open transport, which the E2EE layer uses exactly
/// as it uses a direct LAN connection. A refusal arrives as a close code and
/// is thrown as a [RelayException] naming why ([RelayFailure]).
class RelayClient {
  /// Creates a [RelayClient]. [createTransport] builds a fresh transport per
  /// connection; [identity] resolves the phone's permanent identity.
  ///
  /// [readyTimeout] outlasts the relay's own dial timeout
  /// (`RELAY_DIAL_TIMEOUT_MS`, 10 s), so a bridge that does not answer is
  /// reported with the relay's `bridgeTimeout` close rather than a guess.
  RelayClient({
    required WebSocketTransport Function() createTransport,
    required Future<PhoneIdentity> Function() identity,
    HandshakeCrypto? crypto,
    Duration connectTimeout = const Duration(seconds: 10),
    Duration challengeTimeout = const Duration(seconds: 10),
    Duration readyTimeout = const Duration(seconds: 15),
  })  : _createTransport = createTransport,
        _identity = identity,
        _crypto = crypto ?? HandshakeCrypto(),
        _connectTimeout = connectTimeout,
        _challengeTimeout = challengeTimeout,
        _readyTimeout = readyTimeout;

  final WebSocketTransport Function() _createTransport;
  final Future<PhoneIdentity> Function() _identity;
  final HandshakeCrypto _crypto;
  final Duration _connectTimeout;
  final Duration _challengeTimeout;
  final Duration _readyTimeout;

  /// Connects to the bridge behind [endpoint] and returns the open transport,
  /// ready for the E2EE handshake. [ticket] is the pairing QR's one-time
  /// relay ticket, for a phone the bridge does not trust yet.
  ///
  /// Throws a [RelayException]; the transport is closed on any failure.
  Future<WebSocketTransport> connect(
    RelayEndpoint endpoint, {
    String? ticket,
  }) async {
    final url = RelayProtocol.phoneUrl(endpoint);
    final transport = _createTransport();
    try {
      try {
        await transport.connect(url).timeout(_connectTimeout);
      } on Object catch (error) {
        throw RelayException(
          RelayFailure.unreachable,
          'Relay unreachable: $error',
          cause: error,
        );
      }
      final frames = StreamQueue<Uint8List>(transport.incoming);
      try {
        await _authenticate(transport, frames, endpoint, url, ticket);
      } finally {
        await frames.cancel(immediate: true);
      }
      return transport;
    } on Object {
      await transport.disconnect().catchError((_) {});
      rethrow;
    }
  }

  Future<void> _authenticate(
    WebSocketTransport transport,
    StreamQueue<Uint8List> frames,
    RelayEndpoint endpoint,
    String url,
    String? ticket,
  ) async {
    final challenge = await _nextControl(
      transport,
      frames,
      _challengeTimeout,
      onTimeout: RelayFailure.authTimeout,
    );
    final nonce = challenge['nonce'];
    if (challenge['t'] != 'challenge' || !RelayProtocol.isNonce(nonce)) {
      throw const RelayException(
        RelayFailure.protocol,
        'The relay did not open with a challenge',
      );
    }
    if (challenge['v'] != RelayProtocol.version) {
      throw RelayException(
        RelayFailure.protocol,
        'The relay speaks control protocol v${challenge['v']}; this app '
        'speaks v${RelayProtocol.version}. Update the relay from its bridge.',
      );
    }

    final identity = await _identity();
    final message = RelayProtocol.phoneSigningMessage(
      host: RelayProtocol.hostOf(url),
      routingId: endpoint.routingId,
      nonce: nonce as String,
    );
    final signature = await _crypto.sign(
      Uint8List.fromList(utf8.encode(message)),
      identity.privateSeed,
    );
    await transport.sendText(
      jsonEncode({
        't': 'phone-auth',
        'key': identity.publicKey.toHex(),
        'sig': signature.toHex(),
        if (ticket != null) 'ticket': ticket,
      }),
    );

    final ready = await _nextControl(
      transport,
      frames,
      _readyTimeout,
      onTimeout: RelayFailure.bridgeTimeout,
    );
    if (ready['t'] != 'ready') {
      throw RelayException(
        RelayFailure.protocol,
        'Expected the relay to say ready, got "${ready['t']}"',
      );
    }
  }

  /// The next control frame (a JSON object), skipping a stray keepalive
  /// `pong`. The socket ending first is the relay refusing: its close code
  /// says why.
  Future<Map<String, dynamic>> _nextControl(
    WebSocketTransport transport,
    StreamQueue<Uint8List> frames,
    Duration timeout, {
    required RelayFailure onTimeout,
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (true) {
      final left = deadline.difference(DateTime.now());
      final bool more;
      try {
        more = await frames.hasNext.timeout(
          left.isNegative ? Duration.zero : left,
        );
      } on TimeoutException {
        throw RelayException(
          onTimeout,
          'The relay did not answer within ${timeout.inSeconds}s',
        );
      }
      if (!more) {
        final code = transport.closeCode;
        throw RelayException(
          RelayFailure.fromCloseCode(code),
          'The relay closed the connection'
          '${code == null ? '' : ' ($code)'}',
        );
      }
      final text = utf8.decode(await frames.next, allowMalformed: true);
      if (text == RelayProtocol.pong) continue;
      final Object? frame;
      try {
        frame = jsonDecode(text);
      } on FormatException {
        throw const RelayException(
          RelayFailure.protocol,
          'The relay sent a frame that is not JSON',
        );
      }
      if (frame is Map<String, dynamic>) return frame;
      throw const RelayException(
        RelayFailure.protocol,
        'The relay sent a frame that is not an object',
      );
    }
  }
}
