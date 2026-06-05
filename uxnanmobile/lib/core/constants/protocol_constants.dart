/// Constants that define the Uxnan secure transport and pairing protocol.
///
/// Values mirror the canonical specification in
/// `architecture/02a-system-architecture.md` (section 5.9.1). The original
/// spec names them in SCREAMING_CASE; here they use Dart's lowerCamelCase
/// convention with the spec name noted in each doc comment.
class ProtocolConstants {
  const ProtocolConstants._();

  /// `SECURE_PROTOCOL_VERSION` — version of the E2EE handshake protocol.
  static const int secureProtocolVersion = 1;

  /// `PAIRING_QR_VERSION` — version of the QR pairing payload (`v` field).
  static const int pairingQrVersion = 2;

  /// `HKDF_INFO_TAG` — HKDF info string used when deriving the session key.
  static const String hkdfInfoTag = 'uxnan-e2ee-v1';

  /// `MAX_PAIRING_AGE_MS` — maximum age of a QR payload before it expires.
  static const Duration maxPairingAge = Duration(milliseconds: 300000);

  /// `CLOCK_SKEW_TOLERANCE_MS` — allowed clock skew during a QR bootstrap.
  static const Duration clockSkewTolerance = Duration(milliseconds: 60000);

  /// `TRUSTED_RECONNECT_SKEW_MS` — allowed clock skew on trusted reconnect.
  static const Duration trustedReconnectSkew = Duration(milliseconds: 90000);

  /// `MAX_BRIDGE_OUTBOUND_MESSAGES` — outbound replay buffer size (messages).
  static const int maxBridgeOutboundMessages = 500;

  /// `MAX_BRIDGE_OUTBOUND_BYTES` — outbound replay buffer size (bytes, 10 MB).
  static const int maxBridgeOutboundBytes = 10485760;
}
