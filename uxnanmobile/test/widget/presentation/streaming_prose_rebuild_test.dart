import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';

/// The point of the streaming split is that a settled paragraph is not built
/// again when the next one arrives. Counting Markdown bodies proves the shape;
/// this proves the *saving*, by checking that the widget instance behind a
/// settled chunk survives a delta — which is what lets Flutter skip it.
void main() {
  Message streaming(String text) => Message(
        id: 'm1',
        threadId: 'th1',
        turnId: 't1',
        role: MessageRole.assistant,
        contents: [TextContent(text, isStreaming: true)],
        deliveryState: MessageDeliveryState.delivered,
        orderIndex: 0,
        createdAt: DateTime(2026, 8, 11),
      );

  Future<void> pumpReply(WidgetTester tester, String text) async {
    tester.view.physicalSize = const Size(720, 4000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: MessageBubble(message: streaming(text)),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('settled paragraphs become their own Markdown bodies',
      (tester) async {
    await pumpReply(tester, 'Uno.\n\nDos.\n\nTres a medio escr');
    // Three chunks: two settled, one still growing.
    expect(find.byType(MarkdownBody), findsNWidgets(3));
  });

  testWidgets('a delta leaves the settled bodies untouched', (tester) async {
    const settled = 'Primero, un párrafo entero.\n\nSegundo, otro entero.\n\n';
    await pumpReply(tester, '${settled}Tercero a medio');

    Element bodyAt(int index) =>
        tester.elementList(find.byType(MarkdownBody)).elementAt(index);
    final firstBefore = bodyAt(0).widget;
    final secondBefore = bodyAt(1).widget;
    final tailBefore = bodyAt(2).widget;

    // One more delta lands: only the tail may be rebuilt.
    await pumpReply(tester, '${settled}Tercero a medio escribir');

    expect(
      identical(bodyAt(0).widget, firstBefore),
      isTrue,
      reason: 'the first settled paragraph was rebuilt',
    );
    expect(
      identical(bodyAt(1).widget, secondBefore),
      isTrue,
      reason: 'the second settled paragraph was rebuilt',
    );
    expect(
      identical(bodyAt(2).widget, tailBefore),
      isFalse,
      reason: 'the growing tail must be the one that is rebuilt',
    );
  });

  testWidgets('a chunk settles once its boundary is written', (tester) async {
    await pumpReply(tester, 'Uno.\n\nDos sin terminar');
    expect(find.byType(MarkdownBody), findsNWidgets(2));

    // The blank line arrives and a third paragraph starts: the second chunk is
    // now final and the tail moves on.
    await pumpReply(tester, 'Uno.\n\nDos sin terminar.\n\nTres');
    expect(find.byType(MarkdownBody), findsNWidgets(3));
  });
}
