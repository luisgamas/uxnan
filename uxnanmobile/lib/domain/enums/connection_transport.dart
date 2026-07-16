/// How the phone reached a bridge for a given connection session.
///
/// The E2EE semantics are identical on either channel; this only records which
/// path the live channel actually used, for the connection metrics.
enum ConnectionTransport {
  /// A direct LAN/Tailscale host (`ws://host:port`).
  direct,

  /// The hosted relay fallback (`wss://…`).
  relay,
}
