import 'package:uxnan/domain/value_objects/relay_endpoint.dart';

/// How the phone reaches a PC's bridge right now: on the same network, over
/// the user's Tailscale tailnet, or through the user's own relay
/// (`ConnectionRoute` in `shared/src/models/session.ts`, architecture/02a
/// §5.9.3).
///
/// The bridge reports the same three for every phone it serves
/// (`ClientPresence.route`, `ConnectedPhone.route`), so the phone and Uxnan
/// Desktop name a connection the same way. The E2EE semantics are identical on
/// all three; this only says which path the live channel took.
enum ConnectionRoute {
  /// A direct address on the PC's own network — and any other direct address
  /// that is not a tailnet one, exactly as the bridge counts it.
  lan,

  /// A direct address on the user's Tailscale tailnet ([isTailscaleAddress]).
  tailscale,

  /// The bridge's own relay, which the user runs in their own account.
  relay;

  /// Parses the wire value; `null` when absent or unknown (an older bridge).
  static ConnectionRoute? fromWire(Object? value) => switch (value) {
        'lan' => lan,
        'tailscale' => tailscale,
        'relay' => relay,
        _ => null,
      };
}

/// Whether [address] (an IP as a socket reports it, or a URL host) belongs to
/// a Tailscale tailnet: IPv4 `100.64.0.0/10` (Tailscale's CGNAT range) or IPv6
/// `fd7a:115c:a1e0::/48`. Anything else reached directly is the local network.
///
/// A line-for-line mirror of `isTailscaleAddress` in
/// `shared/src/models/session.ts` — same trimming, brackets and IPv4-mapped
/// prefix, same 1–3-digit octets — so the phone and the bridge never classify
/// one address two ways. Its tests use the shared module's vectors.
bool isTailscaleAddress(String address) {
  final host = address
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'^\[|\]$'), '')
      .replaceFirst(RegExp('^::ffff:'), '');
  if (host.startsWith('fd7a:115c:a1e0:')) return true;
  final octets = host.split('.');
  if (octets.length != 4 || !octets.every(_octet.hasMatch)) return false;
  final a = int.parse(octets[0]);
  final b = int.parse(octets[1]);
  return a == 100 && b >= 64 && b <= 127;
}

final RegExp _octet = RegExp(r'^\d{1,3}$');

/// The route of a direct (non-relay) connection to [address]: Tailscale for a
/// tailnet address, the LAN otherwise (`directRoute` in `shared/`).
ConnectionRoute directRoute(String address) => isTailscaleAddress(address)
    ? ConnectionRoute.tailscale
    : ConnectionRoute.lan;

/// The route of a live channel served through [endpointUrl] — the URL the
/// transport actually connected to — for a PC whose relay is [relay]. Pure and
/// side-effect free (no DNS, no I/O).
///
/// `null` when there is no endpoint (not connected). The relay when
/// [endpointUrl] is on the relay's host (the phone dials a path under its base
/// URL, and no direct host can live there); otherwise [directRoute] of the
/// endpoint's host.
ConnectionRoute? routeOfEndpoint(String? endpointUrl, {RelayEndpoint? relay}) {
  if (endpointUrl == null || endpointUrl.trim().isEmpty) return null;
  final host = _hostOf(endpointUrl);
  if (relay != null) {
    final relayHost = _hostOf(relay.url);
    if (endpointUrl == relay.url ||
        (host != null && host.isNotEmpty && host == relayHost)) {
      return ConnectionRoute.relay;
    }
  }
  return directRoute(host ?? endpointUrl);
}

/// The host of a `scheme://host[:port][/path]` URL or of a bare `host[:port]`
/// (the shape `DirectTransportSelector` dials when an advertised host carries
/// no scheme). [Uri.tryParse] alone is not enough for the bare form: it reads
/// `host.local:9000` as a URI whose *scheme* is `host.local`. An IPv6 literal
/// keeps its brackets off (`[fd7a::1]:9000` → `fd7a::1`).
String? _hostOf(String url) {
  final hasScheme = RegExp('^[a-zA-Z][a-zA-Z0-9+.-]*://').hasMatch(url);
  if (hasScheme) {
    final uri = Uri.tryParse(url);
    return (uri != null && uri.host.isNotEmpty) ? uri.host : null;
  }
  final authority = url.split('/').first.split('?').first.trim();
  if (authority.isEmpty) return null;
  if (authority.startsWith('[')) {
    final close = authority.indexOf(']');
    return close > 0 ? authority.substring(1, close) : authority;
  }
  final colon = authority.lastIndexOf(':');
  return colon > 0 ? authority.substring(0, colon) : authority;
}
