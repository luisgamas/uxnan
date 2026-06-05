import 'dart:typed_data';

/// The phone's permanent Ed25519 identity.
///
/// Generated once on first launch and persisted in secure storage (spec 02b
/// §5.2). The [privateSeed] must never leave the device or be logged.
class PhoneIdentity {
  /// Creates a [PhoneIdentity].
  const PhoneIdentity({
    required this.phoneDeviceId,
    required this.publicKey,
    required this.privateSeed,
  });

  /// Stable per-install device identifier (UUID).
  final String phoneDeviceId;

  /// Ed25519 public key (32 bytes).
  final Uint8List publicKey;

  /// Ed25519 private seed (32 bytes) — secure storage only.
  final Uint8List privateSeed;
}
