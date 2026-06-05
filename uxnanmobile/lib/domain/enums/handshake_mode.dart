/// The mode used when establishing a secure session with the bridge.
enum HandshakeMode {
  /// First-time pairing bootstrapped by scanning the bridge's QR code.
  qrBootstrap,

  /// Reconnection using a previously stored trusted-device relationship.
  trustedReconnect,
}
