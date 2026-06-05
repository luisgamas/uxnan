import 'dart:async';

import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// Correlates outbound JSON-RPC requests with their responses by id.
///
/// Defined in `architecture/02a-system-architecture.md` (section 5.9.4). The
/// caller is responsible for actually sending the encoded/encrypted request;
/// this class only tracks the pending futures and applies a [timeout].
class RequestCorrelator {
  /// Creates a [RequestCorrelator] with the given per-request [timeout].
  RequestCorrelator({this.timeout = const Duration(seconds: 30)});

  /// Maximum time to wait for a response before failing the request.
  final Duration timeout;

  final Map<String, Completer<RpcMessage>> _pending =
      <String, Completer<RpcMessage>>{};

  /// Registers a pending request [id] and returns its response future.
  ///
  /// The future fails with a [TimeoutException] if no response arrives within
  /// [timeout].
  Future<RpcMessage> register(String id) {
    final existing = _pending[id];
    if (existing != null) {
      return existing.future;
    }
    final completer = Completer<RpcMessage>();
    _pending[id] = completer;
    Timer(timeout, () {
      if (!completer.isCompleted) {
        _pending.remove(id);
        completer.completeError(
          TimeoutException('RPC request $id timed out', timeout),
        );
      }
    });
    return completer.future;
  }

  /// Resolves the pending request matching [response]'s id.
  ///
  /// Returns `true` if a matching request was found and completed.
  bool resolve(RpcMessage response) {
    final id = response.id;
    if (id == null) return false;
    final completer = _pending.remove(id);
    if (completer == null || completer.isCompleted) return false;
    completer.complete(response);
    return true;
  }

  /// Fails every pending request with [error] (e.g. on disconnect).
  void rejectAll(Object error, [StackTrace? stackTrace]) {
    for (final completer in _pending.values) {
      if (!completer.isCompleted) {
        completer.completeError(error, stackTrace);
      }
    }
    _pending.clear();
  }

  /// Number of in-flight requests.
  int get pendingCount => _pending.length;
}
