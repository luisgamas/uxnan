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

  /// An envelope failed authenticated decryption (AES-256-GCM tag mismatch).
  decryption,

  /// A message exceeded the maximum allowed size.
  messageTooLarge,

  /// The operation timed out.
  timeout,
}
