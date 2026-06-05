/// Base type for all domain and application level exceptions in Uxnan.
///
/// Concrete subtypes (`RpcException`, `TransportException`) carry protocol
/// specific detail. Catch [AppException] to handle any expected failure that
/// originates inside the app's own logic.
abstract class AppException implements Exception {
  /// Creates an [AppException] with a human readable [message] and an optional
  /// [cause] (the underlying error that triggered this exception).
  const AppException(this.message, {this.cause});

  /// A human readable description of the failure.
  final String message;

  /// The underlying error that caused this exception, if any.
  final Object? cause;

  @override
  String toString() {
    final causeText = cause == null ? '' : ' (cause: $cause)';
    return '$runtimeType: $message$causeText';
  }
}
