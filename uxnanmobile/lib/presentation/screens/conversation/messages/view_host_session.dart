import 'dart:convert';

import 'package:uxnan/domain/value_objects/agent_view.dart';

/// Parsed page-originated protocol messages, isolated from the WebView API.
class ViewHostSession {
  ViewHostSession({required this.viewId, required this.title});

  final String viewId;
  final String title;
  static const int maxMessageBytes = 8 * 1024;
  static const Set<String> _methods = {
    'ui/initialize',
    'ui/notifications/initialized',
    'ui/notifications/size-changed',
    'ui/open-link',
    'ui/message',
    'uxnan/annotation',
  };

  /// Validates one JavaScript-channel message and responds through the host
  /// callback. Invalid or unknown messages are ignored without reaching app UI.
  Future<void> handle(
    String raw, {
    required Map<String, Object?> hostContext,
    required Future<void> Function(Map<String, Object?> message) sendToPage,
    required Future<bool> Function(Uri uri) confirmOpenLink,
    required Future<void> Function(String text) offerMessage,
    required Future<void> Function(ViewAnnotation annotation) annotate,
    required void Function(double height) sizeChanged,
  }) async {
    if (utf8.encode(raw).length > maxMessageBytes) return;
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return;
    }
    if (decoded is! Map || decoded['jsonrpc'] != '2.0') return;
    final method = decoded['method'];
    if (method is! String || !_methods.contains(method)) return;
    final id = decoded['id'];
    if (decoded.containsKey('id') &&
        (id == null ||
            (id is String && id.length > 128) ||
            (id is num && !id.isFinite))) {
      return;
    }
    if (id != null && id is! String && id is! num) return;
    final isRequest = id != null;
    final params = decoded['params'];
    if (params != null && params is! Map) return;
    final fields = params is Map ? params : const <Object?, Object?>{};

    switch (method) {
      case 'ui/initialize':
        if (!isRequest) return;
        await sendToPage({
          'jsonrpc': '2.0',
          'id': id,
          'result': {'hostContext': hostContext},
        });
        return;
      case 'ui/notifications/initialized':
        if (isRequest) return;
        return;
      case 'ui/notifications/size-changed':
        if (isRequest) return;
        final height = fields['height'];
        final width = fields['width'];
        if (height is num &&
            height.isFinite &&
            width is num &&
            width.isFinite &&
            width >= 0 &&
            width <= 100000) {
          sizeChanged(clampViewHeight(height).toDouble());
        }
        return;
      case 'ui/open-link':
        if (!isRequest) return;
        final rawUrl = fields['url'];
        final uri = rawUrl is String && rawUrl.length <= 2048
            ? Uri.tryParse(rawUrl)
            : null;
        if (uri == null ||
            !const {'http', 'https', 'mailto'}.contains(uri.scheme) ||
            (uri.scheme != 'mailto' && uri.host.isEmpty)) {
          await _error(sendToPage, id, -32602, 'Invalid URL');
          return;
        }
        if (await confirmOpenLink(uri)) {
          await _result(sendToPage, id, const {});
        } else {
          await _error(sendToPage, id, -32000, 'Opening the link was declined');
        }
        return;
      case 'ui/message':
        if (!isRequest) return;
        final role = fields['role'];
        final content = fields['content'];
        if (role != 'user' || content is! List || content.length > 20) {
          await _error(sendToPage, id, -32602, 'Invalid message');
          return;
        }
        final text = StringBuffer();
        for (final part in content) {
          if (part is! Map ||
              part['type'] != 'text' ||
              part['text'] is! String) {
            await _error(sendToPage, id, -32602, 'Invalid message content');
            return;
          }
          final value = part['text'] as String;
          if (value.length > 4000 || text.length + value.length > 8000) {
            await _error(sendToPage, id, -32602, 'Message is too long');
            return;
          }
          if (text.isNotEmpty) text.write('\n');
          text.write(value);
        }
        await offerMessage(text.toString());
        await _result(sendToPage, id, const {});
        return;
      case 'uxnan/annotation':
        if (isRequest) return;
        final annotation = ViewAnnotation.parse(fields);
        if (annotation != null) await annotate(annotation);
        return;
    }
  }

  Future<void> _result(
    Future<void> Function(Map<String, Object?>) send,
    Object? id,
    Object result,
  ) =>
      send({'jsonrpc': '2.0', 'id': id, 'result': result});

  Future<void> _error(
    Future<void> Function(Map<String, Object?>) send,
    Object? id,
    int code,
    String message,
  ) =>
      send({
        'jsonrpc': '2.0',
        'id': id,
        'error': {'code': code, 'message': message},
      });

  /// Builds a host notification used when the app's color scheme changes.
  Map<String, Object?> contextChanged(Map<String, Object?> hostContext) => {
        'jsonrpc': '2.0',
        'method': 'ui/notifications/host-context-changed',
        'params': hostContext,
      };

  /// Builds the annotation-mode host notification.
  Map<String, Object?> annotateMode({required bool on}) => {
        'jsonrpc': '2.0',
        'method': 'uxnan/annotate',
        'params': {'on': on},
      };
}
