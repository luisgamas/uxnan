import 'package:equatable/equatable.dart';

/// A JSON-RPC 2.0 error object.
///
/// Implements [Exception] because the transport layer raises it as a thrown
/// error when a request fails (e.g. the bridge refuses a path); callers catch
/// it like any other exception.
class RpcError extends Equatable implements Exception {
  /// Creates an [RpcError].
  const RpcError({required this.code, required this.message, this.data});

  /// Reconstructs an [RpcError] from its JSON form.
  factory RpcError.fromJson(Map<String, dynamic> json) => RpcError(
        code: json['code'] as int,
        message: json['message'] as String,
        data: json['data'],
      );

  /// JSON-RPC error code.
  final int code;

  /// Human readable error message.
  final String message;

  /// Optional structured error payload.
  final Object? data;

  /// Serializes this error to JSON.
  Map<String, dynamic> toJson() => {
        'code': code,
        'message': message,
        if (data != null) 'data': data,
      };

  @override
  List<Object?> get props => [code, message, data];
}

/// A JSON-RPC 2.0 message: request, notification or response.
///
/// Mirrors the value object in `architecture/02a-system-architecture.md`
/// (section 5.1.3). A message is a request when it has both [method] and [id],
/// a notification when it has [method] but no [id], and a response when it has
/// [id] but no [method].
class RpcMessage extends Equatable {
  /// Creates an [RpcMessage]. Prefer the [RpcMessage.request],
  /// [RpcMessage.notification] and [RpcMessage.response] factories.
  const RpcMessage({
    this.jsonrpc = '2.0',
    this.id,
    this.method,
    this.params,
    this.result,
    this.error,
  });

  /// Builds a request with the given [id], [method] and optional [params].
  factory RpcMessage.request({
    required String id,
    required String method,
    Map<String, dynamic>? params,
  }) =>
      RpcMessage(id: id, method: method, params: params);

  /// Builds a notification (no [id]).
  factory RpcMessage.notification({
    required String method,
    Map<String, dynamic>? params,
  }) =>
      RpcMessage(method: method, params: params);

  /// Builds a response for [id] carrying [result] or [error].
  factory RpcMessage.response({
    required String id,
    Object? result,
    RpcError? error,
  }) =>
      RpcMessage(id: id, result: result, error: error);

  /// Parses an [RpcMessage] from its JSON form. Numeric ids are coerced to
  /// strings so they can be correlated uniformly.
  factory RpcMessage.fromJson(Map<String, dynamic> json) {
    final rawId = json['id'];
    final String? id;
    if (rawId is String) {
      id = rawId;
    } else if (rawId is num) {
      id = rawId.toString();
    } else {
      id = null;
    }
    final rawError = json['error'];
    return RpcMessage(
      jsonrpc: json['jsonrpc'] as String? ?? '2.0',
      id: id,
      method: json['method'] as String?,
      params: (json['params'] as Map?)?.cast<String, dynamic>(),
      result: json['result'],
      error: rawError is Map
          ? RpcError.fromJson(rawError.cast<String, dynamic>())
          : null,
    );
  }

  /// JSON-RPC version, always `"2.0"`.
  final String jsonrpc;

  /// Message id; `null` for notifications.
  final String? id;

  /// Method name; `null` for responses.
  final String? method;

  /// Request/notification parameters.
  final Map<String, dynamic>? params;

  /// Response result payload.
  final Object? result;

  /// Response error, if the call failed.
  final RpcError? error;

  /// Whether this message is a request (has [method] and [id]).
  bool get isRequest => method != null && id != null;

  /// Whether this message is a notification (has [method], no [id]).
  bool get isNotification => method != null && id == null;

  /// Whether this message is a response (has [id], no [method]).
  bool get isResponse => method == null && id != null;

  /// Serializes this message to JSON.
  Map<String, dynamic> toJson() => {
        'jsonrpc': jsonrpc,
        if (id != null) 'id': id,
        if (method != null) 'method': method,
        if (params != null) 'params': params,
        if (result != null) 'result': result,
        if (error != null) 'error': error!.toJson(),
      };

  @override
  List<Object?> get props => [jsonrpc, id, method, params, result, error];
}
