import 'package:uxnan/core/errors/app_exception.dart';

/// Raised when the secure WebSocket transport fails.
///
/// Covers connection loss, handshake failures, decryption errors and message
/// size violations at the transport boundary. The [kind] discriminates the
/// failure category so callers can decide whether to retry or surface an error.
class TransportException extends AppException {
  /// Creates a [TransportException] of the given [kind].
  const TransportException(
    this.kind,
    super.message, {
    super.cause,
  });

  /// The category of transport failure.
  final TransportErrorKind kind;

  @override
  String toString() => 'TransportException(${kind.name}): $message';
}

/// Categories of transport-level failures.
enum TransportErrorKind {
  /// The underlying socket could not be opened or was closed unexpectedly.
  connection,

  /// The E2EE handshake did not complete successfully.
  handshake,

  /// The bridge speaks a different `SECURE_PROTOCOL_VERSION` than this app, so
  /// the two cannot exchange encrypted frames at all. Distinct from
  /// [handshake] because it is not a failure the user can retry — both sides
  /// must be updated — and blaming the QR/code instead sends them in circles.
  incompatibleVersion,

  /// An envelope failed authenticated decryption (AES-256-GCM tag mismatch).
  decryption,

  /// An envelope's sequence number violated replay protection.
  replay,

  /// A message exceeded the maximum allowed size.
  messageTooLarge,

  /// The operation timed out.
  timeout,
}
