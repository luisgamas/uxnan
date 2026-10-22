import 'dart:async';
import 'dart:collection';

import 'package:uxnan/core/errors/rpc_exception.dart';
import 'package:uxnan/domain/entities/step_page.dart';
import 'package:uxnan/domain/repositories/i_turn_detail_repository.dart';
import 'package:uxnan/domain/services/work_runs.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// Sends one JSON-RPC request to the bridge.
typedef TurnDetailRpcSend = Future<RpcMessage> Function(
  String method,
  Map<String, dynamic>? params,
);

/// Reads a reply's detail from the bridge (`turn/steps`, `turn/step`) and
/// keeps the last few answers in memory, so a work log
/// scrolled away and back, or a step opened twice, is not asked for again.
/// Bounded by count: a step page is at most 256 KiB, a whole step as large as
/// the agent made it — which is why only a few are kept.
class BridgeTurnDetailRepository implements ITurnDetailRepository {
  /// Creates a [BridgeTurnDetailRepository].
  BridgeTurnDetailRepository(
    this._sendRequest, {
    this.stepPageCacheSize = 24,
    this.wholeCacheSize = 6,
  });

  final TurnDetailRpcSend _sendRequest;

  /// How many step pages are kept.
  final int stepPageCacheSize;

  /// How many whole steps are kept.
  final int wholeCacheSize;

  final LinkedHashMap<String, Future<StepPage>> _pages = LinkedHashMap();
  final LinkedHashMap<String, Future<MessageContent>> _steps = LinkedHashMap();

  @override
  Future<StepPage> readSteps(
    String threadId,
    String turnId, {
    required int from,
    required int to,
    bool fresh = false,
  }) {
    if (from < 0 || to < from) {
      throw ArgumentError('Invalid step range $from..$to');
    }
    final key = '$threadId\u0000$turnId\u0000$from\u0000$to';
    if (fresh) _pages.remove(key);
    return _cached(_pages, key, stepPageCacheSize, () async {
      final result = await _call('turn/steps', {
        'threadId': threadId,
        'turnId': turnId,
        'from': from,
        'to': to,
      });
      final rawSteps = result['steps'];
      if (rawSteps is! List) {
        throw StateError('The bridge returned no steps.');
      }
      final steps = <MessageContent>[
        for (final raw in rawSteps)
          if (raw is Map) MessageContent.fromJson(raw.cast<String, dynamic>()),
      ].where((step) => stepIndexOf(step) != null).toList();
      final next = result['next'];
      return StepPage(
        steps: steps,
        // A `next` that does not move forward would ask for the same page
        // again forever.
        next: next is int && next > from ? next : null,
      );
    });
  }

  @override
  Future<MessageContent> readStep(String threadId, String turnId, int index) {
    if (index < 0) throw ArgumentError.value(index, 'index');
    final key = '$threadId\u0000$turnId\u0000$index';
    return _cached(_steps, key, wholeCacheSize, () async {
      final result = await _call('turn/step', {
        'threadId': threadId,
        'turnId': turnId,
        'index': index,
      });
      final block = result['block'];
      if (block is! Map) {
        throw StateError('The bridge returned no step.');
      }
      return MessageContent.fromJson(block.cast<String, dynamic>());
    });
  }

  /// One request; its error, when the bridge answered one, as an
  /// [RpcException] carrying the bridge's code.
  Future<Map<String, dynamic>> _call(
    String method,
    Map<String, dynamic> params,
  ) async {
    final response = await _sendRequest(method, params);
    final error = response.error;
    if (error != null) {
      throw RpcException(error.code, error.message, data: error.data);
    }
    final result = response.result;
    if (result is! Map) {
      throw StateError('The bridge returned no answer to $method.');
    }
    return result.cast<String, dynamic>();
  }

  /// [read] once per [key] while it stays among the [size] most recent; a
  /// failure is forgotten so the next ask tries again.
  Future<T> _cached<T>(
    LinkedHashMap<String, Future<T>> cache,
    String key,
    int size,
    Future<T> Function() read,
  ) {
    final cached = cache.remove(key);
    if (cached != null) {
      cache[key] = cached;
      return cached;
    }
    final request = read();
    cache[key] = request;
    while (cache.length > size) {
      cache.remove(cache.keys.first);
    }
    unawaited(
      request.then<void>(
        (_) {},
        onError: (Object _, StackTrace __) {
          if (identical(cache[key], request)) cache.remove(key);
        },
      ),
    );
    return request;
  }
}
