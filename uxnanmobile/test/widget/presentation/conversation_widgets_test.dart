import 'package:flutter/material.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/approval_risk.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/plan_step_status.dart';
import 'package:uxnan/domain/enums/subagent_action_kind.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_content_view.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';

const _environment = SessionEnvironment(
  modelName: 'Claude Opus 4.8',
  gitBranch: 'main',
);

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

  testWidgets('renders approval, plan and subagent cards', (tester) async {
    final message = Message(
      id: 'm2',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [
        ApprovalContent(
          ApprovalRequest(
            approvalId: 'a1',
            action: 'Delete build/',
            risk: ApprovalRisk.high,
          ),
        ),
        PlanContent(
          PlanState(
            steps: [
              PlanStep(
                description: 'Write tests',
                status: PlanStepStatus.completed,
              ),
            ],
          ),
        ),
        SubagentContent(
          SubagentState(
            id: 's1',
            name: 'reviewer',
            actions: [
              SubagentAction(
                label: 'Read main.dart',
                kind: SubagentActionKind.tool,
              ),
            ],
          ),
        ),
      ],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pump();

    expect(find.text('Needs approval'), findsOneWidget);
    expect(find.text('Delete build/'), findsOneWidget);
    expect(find.text('High risk'), findsOneWidget);
    expect(find.text('Write tests'), findsOneWidget);
    expect(find.text('reviewer'), findsOneWidget);
    expect(find.text('Read main.dart'), findsOneWidget);
    // Approve/Reject are present but disabled (FOR-DEV).
    expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
  });

  testWidgets('ComposerBar sends trimmed text and clears the field',
      (tester) async {
    String? sent;
    await tester.pumpWidget(
      _wrap(
        ComposerBar(
          environment: _environment,
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

  testWidgets('ComposerBar shows a 0 context meter for usage-reporting agents',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        ComposerBar(
          environment: const SessionEnvironment(
            modelName: 'Opus',
            showContext: true,
          ),
          onSend: (_) {},
        ),
      ),
    );

    // No usage yet → the meter is present at a 0 baseline.
    expect(find.text('0'), findsOneWidget);
  });

  testWidgets('ComposerBar hides the context meter when usage is unreported',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        ComposerBar(
          // showContext defaults to false (e.g. OpenCode).
          environment: const SessionEnvironment(modelName: 'Opus'),
          onSend: (_) {},
        ),
      ),
    );

    expect(find.text('0'), findsNothing);
  });

  testWidgets('ComposerBar does not send when disabled', (tester) async {
    var sentCount = 0;
    await tester.pumpWidget(
      _wrap(
        ComposerBar(
          environment: _environment,
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
