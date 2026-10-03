import 'package:uxnan/domain/value_objects/relay_endpoint.dart';

/// The phone's half of the relay control protocol v1 — mirrors
/// `shared/src/relay/protocol.ts` (architecture/02a §5.10). Only what a phone
/// uses: its route, the frames it reads and writes, and the exact string it
/// signs.
///
/// A phone opens `/v1/connect/<routingId>`, receives `challenge`, answers
/// `phone-auth`, and waits for `ready` (sent once the bridge has opened this
/// phone's channel). From then on the socket is a blind pipe: the E2EE
/// handshake and envelopes cross it unchanged.
class RelayProtocol {
  const RelayProtocol._();

  /// `RELAY_PROTOCOL_VERSION`: the control protocol's wire version.
  static const int version = 1;

  /// `RELAY_PATH_PREFIX`: the path every relay route starts with.
  static const String pathPrefix = '/v1';

  /// `RELAY_PONG`: the keepalive answer the relay's runtime sends to a `ping`
  /// text frame. The phone never sends `ping` (its socket keeps itself alive
  /// with WebSocket protocol pings), but a stray `pong` is never a control
  /// frame and is skipped.
  static const String pong = 'pong';

  /// The phone route of [endpoint]: `<url>/v1/connect/<routingId>`
  /// (`relayRoutePath('phone', …)`).
  static String phoneUrl(RelayEndpoint endpoint) =>
      '${endpoint.url}$pathPrefix/connect/${endpoint.routingId}';

  /// The `host[:port]` of [url] exactly as the relay sees it (`URL.host`):
  /// the port only when it is not the scheme's default, an IPv6 literal in
  /// brackets. Part of what the phone signs, so a signature made for one
  /// relay cannot be replayed against another.
  static String hostOf(String url) {
    final uri = Uri.parse(url);
    final host = uri.host.contains(':') ? '[${uri.host}]' : uri.host;
    final defaultPort = switch (uri.scheme) {
      'ws' || 'http' => 80,
      'wss' || 'https' => 443,
      _ => null,
    };
    return uri.hasPort && uri.port != defaultPort ? '$host:${uri.port}' : host;
  }

  /// `relaySigningMessage` for the phone route: the UTF-8 string a phone
  /// signs with its Ed25519 identity key to answer the challenge [nonce].
  /// The phone route carries no channel id, so that field is empty.
  static String phoneSigningMessage({
    required String host,
    required String routingId,
    required String nonce,
  }) =>
      ['uxnan-relay-v$version', 'phone', host, routingId, '', nonce].join('|');

  static final RegExp _nonce = RegExp(r'^[0-9a-f]{64}$');

  /// Whether [value] is a challenge nonce (32 bytes, hex).
  static bool isNonce(Object? value) =>
      value is String && _nonce.hasMatch(value);
}
