import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/conversation/messages/view_host_session.dart';

void main() {
  const annotation = {
    'selector': '#save',
    'tag': 'button',
    'rect': {'x': 1, 'y': 2, 'width': 3, 'height': 4},
  };

  test('answers initialize and turns page messages into a composer offer',
      () async {
    final session = ViewHostSession(
      viewId: '0123456789abcdef0123456789abcdef',
      title: 'Example',
    );
    final sent = <Map<String, Object?>>[];
    final offers = <String>[];
    await session.handle(
      jsonEncode({'jsonrpc': '2.0', 'id': 1, 'method': 'ui/initialize'}),
      hostContext: const {'theme': 'dark', 'platform': 'mobile'},
      sendToPage: (message) async => sent.add(message),
      confirmOpenLink: (_) async => false,
      offerMessage: (message) async => offers.add(message),
      annotate: (_) async {},
      annotationCount: () => 0,
      mark: (_) async {},
      sizeChanged: (_) {},
    );
    expect(sent.single['result'], {
      'hostContext': {'theme': 'dark', 'platform': 'mobile'},
    });

    await session.handle(
      jsonEncode({
        'jsonrpc': '2.0',
        'id': 'm1',
        'method': 'ui/message',
        'params': {
          'role': 'user',
          'content': [
            {'type': 'text', 'text': 'Draft only'},
          ],
        },
      }),
      hostContext: const {},
      sendToPage: (message) async => sent.add(message),
      confirmOpenLink: (_) async => false,
      offerMessage: (message) async => offers.add(message),
      annotate: (_) async {},
      annotationCount: () => 0,
      mark: (_) async {},
      sizeChanged: (_) {},
    );
    expect(offers, ['Draft only']);
    expect(sent.last['result'], isEmpty);
  });

  test('creates host context and annotation notifications', () {
    final session = ViewHostSession(viewId: 'a' * 32, title: 'Example');
    expect(
      session.contextChanged(const {'theme': 'dark'}),
      {
        'jsonrpc': '2.0',
        'method': 'ui/notifications/host-context-changed',
        'params': {'theme': 'dark'},
      },
    );
    expect(
      session.annotateMode(on: true),
      {
        'jsonrpc': '2.0',
        'method': 'uxnan/annotate',
        'params': {'on': true},
      },
    );
  });

  test('ignores malformed, oversized, unknown and invalid annotation messages',
      () async {
    final session = ViewHostSession(viewId: 'id', title: 'T');
    var annotationCount = 0;
    final sizes = <double>[];
    Future<void> handle(String input) => session.handle(
          input,
          hostContext: const {},
          sendToPage: (_) async {},
          confirmOpenLink: (_) async => false,
          offerMessage: (_) async {},
          annotate: (_) async {
            annotationCount++;
          },
          annotationCount: () => 0,
          mark: (_) async {},
          sizeChanged: sizes.add,
        );
    await handle('{');
    await handle('x' * (ViewHostSession.maxMessageBytes + 1));
    await handle(jsonEncode({'jsonrpc': '2.0', 'method': 'unknown'}));
    await handle(
      jsonEncode({
        'jsonrpc': '2.0',
        'method': 'uxnan/annotation',
        'params': {...annotation, 'selector': 'x' * 301},
      }),
    );
    await handle(
      jsonEncode({
        'jsonrpc': '2.0',
        'method': 'ui/notifications/size-changed',
        'params': {'height': 5000, 'width': 400},
      }),
    );
    expect(annotationCount, 0);
    expect(sizes, [1600]);
  });

  test('accepts only in-range mark notifications', () async {
    final session = ViewHostSession(viewId: 'id', title: 'T');
    final marks = <int>[];
    Future<void> handle({Object? id, Object? params}) => session.handle(
          jsonEncode({
            'jsonrpc': '2.0',
            if (id != null) 'id': id,
            'method': 'uxnan/mark',
            if (params != null) 'params': params,
          }),
          hostContext: const {},
          sendToPage: (_) async {},
          confirmOpenLink: (_) async => false,
          offerMessage: (_) async {},
          annotate: (_) async {},
          annotationCount: () => 2,
          mark: (index) async => marks.add(index),
          sizeChanged: (_) {},
        );

    await handle(params: {'index': 0});
    await handle(params: {'index': 1});
    await handle(params: {'index': 2});
    await handle(params: {'index': -1});
    await handle(params: {'index': 0.0});
    await handle(params: {'index': '0'});
    await handle(params: {});
    await handle(params: ['0']);
    await handle(id: 1, params: {'index': 0});
    await handle();

    expect(marks, [0, 1]);
  });
}
