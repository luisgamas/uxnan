/// How the phone's LIVE channel reaches the bridge, classified from the
/// endpoint the connection actually settled on
/// (`SessionCoordinator.connectedEndpoint`).
///
/// The E2EE semantics and the dial race itself (spec 02a §5.9.3) are
/// unchanged by this — [DirectTransportSelector] already races every
/// advertised host and falls back to the relay; this only labels which of
/// those paths won, so the devices screen can show something more useful than
/// a raw IP. Purely informational, purely client-side: no wire/contract
/// change backs it.
enum NetworkKind {
  /// A private LAN address (RFC 1918 / link-local) — same network as the PC.
  lan,

  /// A Tailscale (or compatible CGNAT, `100.64.0.0/10`) address.
  tailscale,

  /// A direct address that isn't a recognized private/Tailscale range (a
  /// public IP or a plain hostname) — reachable directly, just not on a
  /// private network the phone can identify.
  direct,

  /// The hosted relay fallback.
  relay,

  /// Not connected yet, or the endpoint couldn't be classified (e.g. it was
  /// empty). Distinct from "connecting" — callers that care about an
  /// in-flight attempt track that separately (`connectingDeviceProvider`) and
  /// show a detecting/loading state instead of this value.
  unknown,
}

/// Classifies [endpointUrl] — the URL the live channel is actually served
/// through — against [relayUrl] (the paired device's advertised relay). Pure
/// and side-effect free (no DNS/host resolution, no I/O), so it's trivially
/// unit-testable; the UI derives the transport badge from this.
///
/// Rules (checked in order):
/// 1. A null/empty [endpointUrl] → [NetworkKind.unknown].
/// 2. [endpointUrl] equal to [relayUrl], or sharing its host →
///    [NetworkKind.relay].
/// 3. An IPv4 literal host is bucketed by range:
///    - `100.64.0.0/10` (100.64.x.x – 100.127.x.x) → [NetworkKind.tailscale].
///    - `10.0.0.0/8`, `172.16.0.0/12` (172.16.x.x – 172.31.x.x),
///      `192.168.0.0/16`, `169.254.0.0/16` → [NetworkKind.lan].
///    - any other IPv4 → [NetworkKind.direct].
/// 4. A non-IP host (a hostname) that isn't the relay → [NetworkKind.direct].
NetworkKind classifyEndpoint(String? endpointUrl, {required String relayUrl}) {
  if (endpointUrl == null || endpointUrl.isEmpty) return NetworkKind.unknown;
  if (_isRelayEndpoint(endpointUrl, relayUrl)) return NetworkKind.relay;

  final host = _hostOf(endpointUrl);
  if (host == null || host.isEmpty) return NetworkKind.direct;

  final octets = _ipv4Octets(host);
  if (octets == null) {
    return NetworkKind.direct; // a hostname, not an IPv4 literal
  }

  final a = octets[0];
  final b = octets[1];
  if (a == 100 && b >= 64 && b <= 127) return NetworkKind.tailscale;
  if (a == 10) return NetworkKind.lan;
  if (a == 172 && b >= 16 && b <= 31) return NetworkKind.lan;
  if (a == 192 && b == 168) return NetworkKind.lan;
  if (a == 169 && b == 254) return NetworkKind.lan;
  return NetworkKind.direct;
}

/// Whether [endpointUrl] is the relay: an exact match, or the same host as
/// [relayUrl] (a direct dial can't land on the relay's own host, so a host
/// match is a reliable — and scheme/port-tolerant — signal).
bool _isRelayEndpoint(String endpointUrl, String relayUrl) {
  if (relayUrl.isEmpty) return false;
  if (endpointUrl == relayUrl) return true;
  final endpointHost = _hostOf(endpointUrl);
  final relayHost = _hostOf(relayUrl);
  return endpointHost != null &&
      endpointHost.isNotEmpty &&
      endpointHost == relayHost;
}

/// Extracts the host from a `scheme://host[:port][/path]` URL or a bare
/// `host[:port]` string (the shape [DirectTransportSelector] dials when a
/// device's advertised host carries no explicit scheme). `Uri.tryParse`
/// alone isn't enough for the bare form: a dotted hostname like
/// `host.local:9000` is itself valid URI-scheme syntax, so Dart parses
/// `host.local` as the *scheme* and returns an empty host — hence the
/// explicit scheme check before delegating to [Uri.tryParse].
String? _hostOf(String url) {
  final hasScheme = RegExp('^[a-zA-Z][a-zA-Z0-9+.-]*://').hasMatch(url);
  if (hasScheme) {
    final uri = Uri.tryParse(url);
    return (uri != null && uri.host.isNotEmpty) ? uri.host : null;
  }
  final withoutPath = url.split('/').first.split('?').first.trim();
  if (withoutPath.isEmpty) return null;
  final colon = withoutPath.lastIndexOf(':');
  return colon > 0 ? withoutPath.substring(0, colon) : withoutPath;
}

/// Parses [host] as a strict 4-octet IPv4 literal (each octet `0`–`255`), or
/// `null` when it isn't one (a hostname, or an IPv6 literal — neither is in
/// scope for this classifier).
List<int>? _ipv4Octets(String host) {
  final parts = host.split('.');
  if (parts.length != 4) return null;
  final octets = <int>[];
  for (final part in parts) {
    final value = int.tryParse(part);
    if (value == null || value < 0 || value > 255) return null;
    octets.add(value);
  }
  return octets;
}
