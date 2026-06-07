import 'package:uxnan/core/errors/app_exception.dart';

/// Raised when the bridge returns a JSON-RPC error response.
///
/// The [code] matches the JSON-RPC error code table defined in
/// `architecture/02b-contracts-and-requirements.md` (section 1.3). Standard
/// codes are exposed as named constants on this class.
class RpcException extends AppException {
  /// Creates an [RpcException] for the given JSON-RPC [code] and [message].
  ///
  /// [data] carries any structured payload the bridge attached to the error.
  const RpcException(
    this.code,
    super.message, {
    this.data,
    super.cause,
  });

  /// The JSON-RPC error code.
  final int code;

  /// Optional structured error data returned by the bridge.
  final Object? data;

  /// JSON-RPC `Parse error`.
  static const int parseError = -32700;

  /// JSON-RPC `Invalid request`.
  static const int invalidRequest = -32600;

  /// JSON-RPC `Method not found`.
  static const int methodNotFound = -32601;

  /// JSON-RPC `Invalid params`.
  static const int invalidParams = -32602;

  /// JSON-RPC `Internal error`.
  static const int internalError = -32603;

  /// Bridge generic error.
  static const int bridgeError = -32000;

  /// Authentication required.
  static const int authenticationRequired = -32001;

  /// Agent not running.
  static const int agentNotRunning = -32002;

  /// Git operation failed.
  static const int gitOperationFailed = -32003;

  /// Workspace access denied.
  static const int workspaceAccessDenied = -32004;

  /// Bridge version incompatible.
  static const int bridgeVersionIncompatible = -32005;

  /// Session expired.
  static const int sessionExpired = -32006;

  /// Confirmation required before the operation can proceed.
  static const int confirmationRequired = -32007;

  /// Requested resource not found.
  static const int resourceNotFound = -32008;

  @override
  String toString() => 'RpcException($code): $message';
}
