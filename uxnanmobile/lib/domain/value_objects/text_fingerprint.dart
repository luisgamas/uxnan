import 'package:equatable/equatable.dart';

/// A SHA-256 fingerprint of normalized message content, used for dedup.
///
/// Pure value object: it only holds the [hash]. Computation lives in
/// `infrastructure/crypto/fingerprint.dart` because it needs a hashing package
/// (the domain layer stays free of external dependencies — spec 03 §1.6). This
/// deviates from the inline `TextFingerprint.of` factory sketched in 02a §5.1.3
/// to respect the layer boundary.
class TextFingerprint extends Equatable {
  /// Wraps a precomputed SHA-256 [hash] (lowercase hex).
  const TextFingerprint(this.hash);

  /// The SHA-256 hash of the normalized content, lowercase hex.
  final String hash;

  @override
  List<Object?> get props => [hash];

  @override
  String toString() => 'TextFingerprint($hash)';
}
