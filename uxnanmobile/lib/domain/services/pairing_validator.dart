import 'package:uxnan/core/constants/protocol_constants.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';

/// Outcome category of validating a pairing QR.
enum PairingValidationStatus {
  /// The payload is valid and usable.
  valid,

  /// The payload's transcript window has expired.
  expired,

  /// The QR format version is not supported by this app.
  unsupportedVersion,

  /// The payload could not be parsed or is missing required fields.
  malformed,
}

/// The result of validating a pairing QR.
class PairingValidationResult {
  const PairingValidationResult._(this.status, {this.payload, this.reason});

  /// A valid result carrying the parsed [payload].
  factory PairingValidationResult.valid(PairingPayload payload) =>
      PairingValidationResult._(
        PairingValidationStatus.valid,
        payload: payload,
      );

  /// An expired payload.
  factory PairingValidationResult.expired() =>
      const PairingValidationResult._(PairingValidationStatus.expired);

  /// An unsupported QR [version].
  factory PairingValidationResult.unsupportedVersion(int version) =>
      PairingValidationResult._(
        PairingValidationStatus.unsupportedVersion,
        reason: 'Unsupported QR version $version',
      );

  /// A malformed payload, with a human readable [reason].
  factory PairingValidationResult.malformed(String reason) =>
      PairingValidationResult._(
        PairingValidationStatus.malformed,
        reason: reason,
      );

  /// The validation status.
  final PairingValidationStatus status;

  /// The parsed payload, present only when [status] is
  /// [PairingValidationStatus.valid].
  final PairingPayload? payload;

  /// A human readable explanation for non-valid results.
  final String? reason;

  /// Whether the payload is valid.
  bool get isValid => status == PairingValidationStatus.valid;
}

/// Validates pairing QR payloads (spec 02a §5.5.2).
///
/// Pure domain service: checks the QR version, required fields and expiry
/// (with the protocol clock-skew tolerance).
class PairingValidator {
  /// Creates a [PairingValidator].
  const PairingValidator();

  /// Parses and validates a raw Base64 QR string.
  PairingValidationResult validate(String rawQr) {
    final PairingPayload payload;
    try {
      payload = PairingPayload.fromQrString(rawQr);
    } on FormatException catch (error) {
      return PairingValidationResult.malformed(error.message);
    }
    return validatePayload(payload);
  }

  /// Validates an already-parsed [payload].
  PairingValidationResult validatePayload(PairingPayload payload) {
    if (payload.version != ProtocolConstants.pairingQrVersion) {
      return PairingValidationResult.unsupportedVersion(payload.version);
    }
    if (payload.sessionId.isEmpty ||
        payload.macDeviceId.isEmpty ||
        payload.macIdentityPublicKey.isEmpty) {
      return PairingValidationResult.malformed('Missing required fields');
    }
    // At least one transport must be advertised: a relay URL and/or direct
    // LAN/Tailscale hosts (mirrors `shared` `validatePairingPayload`). A pure
    // LAN/Tailscale QR carries only `hosts`.
    final hasRelay = payload.relayUrl.isNotEmpty;
    final hasHosts = payload.hosts.isNotEmpty;
    if (!hasRelay && !hasHosts) {
      return PairingValidationResult.malformed('No transport advertised');
    }
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final toleranceMs = ProtocolConstants.clockSkewTolerance.inMilliseconds;
    if (nowMs > payload.expiresAt + toleranceMs) {
      return PairingValidationResult.expired();
    }
    return PairingValidationResult.valid(payload);
  }
}
