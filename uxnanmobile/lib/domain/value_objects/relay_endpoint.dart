import 'package:equatable/equatable.dart';

/// Where a phone reaches its PC's bridge from another network: the user's own
/// relay (`RelayEndpoint` in `shared/src/models/relay.ts`, architecture/02a
/// §5.10).
///
/// Public data only. The bridge owns it — it deploys the relay into the
/// user's own Cloudflare account and decides whether it serves phones — and
/// shares it with every paired phone in its settings (`BridgeSettings.relay`)
/// and in the pairing QR, so a phone paired at home can leave home without
/// pairing again.
class RelayEndpoint extends Equatable {
  /// Creates a [RelayEndpoint].
  const RelayEndpoint({
    required this.url,
    required this.routingId,
    required this.enabled,
  });

  /// Parses the wire object; `null` when it is absent or malformed (a URL
  /// with a path, a routing id that is not 32 lowercase hex chars, …).
  ///
  /// [defaultEnabled] applies when the object carries no `enabled` field —
  /// the pairing QR's relay has none, because the bridge only advertises a
  /// relay there while it is serving phones through it.
  static RelayEndpoint? fromJson(Object? json, {bool? defaultEnabled}) {
    if (json is! Map) return null;
    final url = json['url'];
    final routingId = json['routingId'];
    final rawEnabled = json['enabled'];
    final enabled = rawEnabled is bool ? rawEnabled : defaultEnabled;
    if (!isRelayUrl(url) || !isRelayId(routingId) || enabled == null) {
      return null;
    }
    return RelayEndpoint(
      url: url as String,
      routingId: routingId as String,
      enabled: enabled,
    );
  }

  /// `wss://…` base URL of the relay, with no path (`ws://` only for a relay
  /// run locally, as the tests do).
  final String url;

  /// The bridge's room on that relay: 32 lowercase hex chars.
  final String routingId;

  /// Whether the bridge is serving phones through the relay right now. The
  /// phone dials a disabled relay never.
  final bool enabled;

  /// The wire object.
  Map<String, Object> toJson() => {
        'url': url,
        'routingId': routingId,
        'enabled': enabled,
      };

  @override
  List<Object?> get props => [url, routingId, enabled];

  static final RegExp _url = RegExp(r'^wss?://[^/\s]+$');
  static final RegExp _id = RegExp(r'^[0-9a-f]{32}$');
  static final RegExp _ticket = RegExp(r'^[A-Za-z0-9_-]{43}$');

  /// Whether [value] is a relay base URL: `ws(s)://host[:port]`, no path.
  static bool isRelayUrl(Object? value) =>
      value is String && _url.hasMatch(value);

  /// Whether [value] is a relay routing or channel id (128 bits, hex).
  static bool isRelayId(Object? value) =>
      value is String && _id.hasMatch(value);

  /// Whether [value] is a one-time pairing ticket (32 bytes, base64url).
  static bool isPairingTicket(Object? value) =>
      value is String && _ticket.hasMatch(value);
}
