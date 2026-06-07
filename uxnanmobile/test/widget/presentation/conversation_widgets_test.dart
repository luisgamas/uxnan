import 'package:flutter/material.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_content_view.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';

Widget _wrap(Widget child) => MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: child),
    );

void main() {
  testWidgets('MessageBubble renders each content block with its renderer',
      (tester) async {
    final message = Message(
      id: 'm1',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [
        TextContent('here is code'),
        CodeContent('print(1)', language: 'dart'),
      ],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pump();

    expect(find.byType(MessageContentView), findsNWidgets(2));
    expect(find.byType(MarkdownBody), findsOneWidget);
    expect(find.byType(HighlightView), findsOneWidget);
  });

  testWidgets('ComposerBar sends trimmed text and clears the field',
      (tester) async {
    String? sent;
    await tester.pumpWidget(
      _wrap(
        ComposerBar(
          environment: SessionEnvironment.sample(),
          onSend: (text) => sent = text,
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), '  hola  ');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.arrow_upward_rounded));
    await tester.pump();

    expect(sent, 'hola');
    expect(find.text('  hola  '), findsNothing);
  });

  testWidgets('ComposerBar does not send when disabled', (tester) async {
    var sentCount = 0;
    await tester.pumpWidget(
      _wrap(
        ComposerBar(
          environment: SessionEnvironment.sample(),
          enabled: false,
          onSend: (_) => sentCount++,
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), 'hi');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.arrow_upward_rounded));
    await tester.pump();

    expect(sentCount, 0);
  });
}
