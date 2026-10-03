import 'dart:convert';
import 'dart:typed_data';

import 'package:equatable/equatable.dart';
import 'package:uxnan/core/constants/protocol_constants.dart';
import 'package:uxnan/core/extensions/uint8list_ext.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';

/// The data carried in a bridge pairing QR code.
///
/// Transported as Base64-encoded JSON (spec 02a §5.5.4). `version` is the QR
/// format version (`PAIRING_QR_VERSION` = 3). Validation lives in
/// `PairingValidator`; this type only parses.
class PairingPayload extends Equatable {
  /// Creates a [PairingPayload].
  const PairingPayload({
    required this.version,
    required this.hosts,
    required this.sessionId,
    required this.macDeviceId,
    required this.macIdentityPublicKey,
    required this.expiresAt,
    required this.displayName,
    this.relay,
    this.relayTicket,
  });

  /// Parses a [PairingPayload] from a raw Base64 QR string.
  ///
  /// Throws a [FormatException] if the string is not valid Base64 JSON or a
  /// required field is missing or malformed.
  factory PairingPayload.fromQrString(String qr) {
    final decoded = utf8.decode(base64.decode(base64.normalize(qr.trim())));
    final json = jsonDecode(decoded);
    if (json is! Map) {
      throw const FormatException('Pairing payload is not a JSON object');
    }
    return PairingPayload.fromJson(json.cast<String, dynamic>());
  }

  /// Parses a [PairingPayload] from its decoded JSON map.
  ///
  /// `relay` and `hosts` are both optional transports — the bridge guarantees
  /// at least one is present (`shared` `validatePairingPayload`), but the
  /// structural parse here is tolerant; the "at least one transport" rule is
  /// enforced by `PairingValidator`. A pure LAN/Tailscale QR carries only
  /// `hosts`.
  ///
  /// `relay` is the object `{url, routingId, ticket?}` since version 3. A QR
  /// of another version is parsed without it, so the validator can say the
  /// version is unsupported instead of calling the code malformed.
  factory PairingPayload.fromJson(Map<String, dynamic> json) {
    T field<T>(String key) {
      final value = json[key];
      if (value is! T) {
        throw FormatException('Missing or invalid pairing field: $key');
      }
      return value;
    }

    final version = field<int>('v');
    final current = version == ProtocolConstants.pairingQrVersion;
    final rawRelay = current ? json['relay'] : null;
    // The QR's relay has no `enabled`: the bridge only advertises a relay it
    // is serving phones through.
    final relay = RelayEndpoint.fromJson(rawRelay, defaultEnabled: true);
    if (rawRelay != null && relay == null) {
      throw const FormatException('Invalid pairing field: relay');
    }
    final rawTicket = rawRelay is Map ? rawRelay['ticket'] : null;
    if (rawTicket != null && !RelayEndpoint.isPairingTicket(rawTicket)) {
      throw const FormatException('Invalid pairing field: relay.ticket');
    }
    final rawHosts = json['hosts'];
    if (rawHosts != null && rawHosts is! List) {
      throw const FormatException('Invalid pairing field: hosts');
    }
    final hosts = rawHosts == null
        ? const <String>[]
        : (rawHosts as List).map((h) {
            if (h is! String) {
              throw const FormatException('Invalid pairing host entry');
            }
            return h;
          }).toList(growable: false);

    return PairingPayload(
      version: version,
      relay: relay,
      relayTicket: rawTicket as String?,
      hosts: hosts,
      sessionId: field<String>('sessionId'),
      macDeviceId: field<String>('macDeviceId'),
      macIdentityPublicKey: field<String>('macIdentityPublicKey').fromHex(),
      expiresAt: field<int>('expiresAt'),
      displayName: field<String>('displayName'),
    );
  }

  /// QR format version.
  final int version;

  /// The bridge's own relay, or `null` for a LAN/Tailscale setup that
  /// advertises only [hosts].
  final RelayEndpoint? relay;

  /// One-time ticket the relay accepts while this pairing window is open, so
  /// a phone that is NOT on the PC's network can pair through the relay for
  /// the first time. Used for that first connection only and never stored.
  final String? relayTicket;

  /// Direct `host:port` addresses where the bridge's LAN server listens (its
  /// non-internal IPv4s — LAN and, if up, a Tailscale `100.x` address). The
  /// phone tries these FIRST and falls back to [relay]. May be empty.
  final List<String> hosts;

  /// Session id to use for the connection.
  final String sessionId;

  /// Bridge device id.
  final String macDeviceId;

  /// Bridge Ed25519 identity public key (32 bytes).
  final Uint8List macIdentityPublicKey;

  /// Expiry as Unix epoch milliseconds.
  final int expiresAt;

  /// Human readable bridge name.
  final String displayName;

  /// The expiry instant (UTC).
  DateTime get expiresAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(expiresAt, isUtc: true);

  @override
  List<Object?> get props => [
        version,
        relay,
        relayTicket,
        hosts,
        sessionId,
        macDeviceId,
        macIdentityPublicKey,
        expiresAt,
        displayName,
      ];
}
