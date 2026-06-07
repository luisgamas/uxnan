/// The phase of the connection lifecycle between the app and the bridge.
///
/// Drives the connection status indicator and gating of network actions in the
/// UI (see `architecture/02a-system-architecture.md` section 5.1.2).
enum ConnectionPhase {
  /// No connection and none being attempted.
  disconnected,

  /// Opening the underlying WebSocket transport.
  connecting,

  /// Performing the E2EE handshake.
  handshaking,

  /// Catching up on missed messages after (re)connecting.
  syncing,

  /// Fully connected with an active secure session.
  connected,

  /// Connection was lost and is being re-established with backoff.
  reconnecting,

  /// A terminal error occurred and manual intervention may be required.
  error,
}
