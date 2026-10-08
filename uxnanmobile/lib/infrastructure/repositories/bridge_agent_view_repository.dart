import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:uxnan/domain/entities/agent_view_page.dart';
import 'package:uxnan/domain/repositories/i_agent_view_repository.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

typedef ViewRpcSend = Future<RpcMessage> Function(
  String method,
  Map<String, dynamic>? params,
);

/// Bridge RPC reader with a small in-memory LRU of prepared pages.
class BridgeAgentViewRepository implements IAgentViewRepository {
  BridgeAgentViewRepository(this._sendRequest, {this.cacheSize = 8})
      : assert(cacheSize > 0, 'cacheSize must be greater than zero');

  final ViewRpcSend _sendRequest;
  final int cacheSize;
  final LinkedHashMap<String, Future<AgentViewPage>> _cache = LinkedHashMap();

  @override
  Future<AgentViewPage> readView(String viewId) {
    final cached = _cache.remove(viewId);
    if (cached != null) {
      _cache[viewId] = cached;
      return cached;
    }
    final request = _fetch(viewId);
    _cache[viewId] = request;
    while (_cache.length > cacheSize) {
      _cache.remove(_cache.keys.first);
    }
    unawaited(
      request.then<void>(
        (_) {},
        onError: (Object error, StackTrace stackTrace) {
          if (identical(_cache[viewId], request)) _cache.remove(viewId);
        },
      ),
    );
    return request;
  }

  Future<AgentViewPage> _fetch(String viewId) async {
    if (!RegExp(r'^[0-9a-f]{32}$').hasMatch(viewId)) {
      throw ArgumentError.value(viewId, 'viewId', 'Invalid view id');
    }
    final response = await _sendRequest('view/read', {'viewId': viewId});
    final result = response.result;
    if (response.error != null || result is! Map) {
      throw StateError('The bridge could not read this view.');
    }
    final id = result['viewId'];
    final title = result['title'];
    final html = result['html'];
    final bytes = result['bytes'];
    if (id != viewId ||
        title is! String ||
        title.isEmpty ||
        title.length > 120 ||
        html is! String ||
        utf8.encode(html).length > 640 * 1024 ||
        bytes is! int ||
        bytes < 0 ||
        bytes > 512 * 1024) {
      throw StateError('The bridge returned an invalid view page.');
    }
    return AgentViewPage(
      viewId: viewId,
      title: title,
      html: html,
      bytes: bytes,
    );
  }
}
