import 'package:flutter/material.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/approval_risk.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/plan_step_status.dart';
import 'package:uxnan/domain/enums/subagent_action_kind.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/infrastructure/speech/speech_to_text_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_content_view.dart';

Widget _wrap(Widget child) => ProviderScope(
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: child),
      ),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // The thinking section reads a shared_preferences-backed setting; default to
  // empty (→ shown) so it hydrates cleanly without the platform channel.
  setUp(() => SharedPreferences.setMockInitialValues({}));

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

  testWidgets(
    'a resolved approval card stays resolved after scroll/restart '
    '(no buttons reappear, decision persists in the store)',
    (tester) async {
      // Pre-seed the store as if the user already approved this card in a
      // previous session. The card must render the resolved view (and NOT
      // the action buttons) on the very first frame after hydration.
      SharedPreferences.setMockInitialValues({
        'uxnan.approval.responses':
            '{"a1":{"decision":"approve","decidedAtMs":1700000000000}}',
      });
      addTearDown(() => SharedPreferences.setMockInitialValues({}));

      final message = Message(
        id: 'm-resolved',
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
        ],
        deliveryState: MessageDeliveryState.delivered,
        orderIndex: 0,
        createdAt: DateTime(2026),
      );

      await tester.pumpWidget(_wrap(MessageBubble(message: message)));
      // Two pumps: one to build, one to let the provider's async hydrate()
      // resolve and the widget rebuild with the persisted resolved state.
      await tester.pump();
      await tester.pump();

      // The "Decision recorded" title replaces the actionable "Needs approval"
      // headline.
      expect(find.text('Needs approval'), findsNothing);
      expect(find.text('Decision recorded'), findsOneWidget);
      // The action buttons are GONE — an answered card can't be re-answered.
      expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Reject'), findsNothing);
      expect(find.text('Always allow this session'), findsNothing);
      // The resolved view shows the decision label and the
      // "Answered" timestamp.
      expect(find.text('Approved'), findsOneWidget);
      expect(find.textContaining('Answered'), findsOneWidget);
    },
  );

  testWidgets(
    'a resolved approval card stays settled while the user scrolls past it',
    (tester) async {
      // The whole conversation is one long list; the card sits inside the
      // off-screen portion initially. Scroll it into view, then away, then
      // back — the buttons must stay gone after the first hydration.
      SharedPreferences.setMockInitialValues({
        'uxnan.approval.responses':
            '{"a1":{"decision":"reject","decidedAtMs":1700000000000}}',
      });
      addTearDown(() => SharedPreferences.setMockInitialValues({}));

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
        ],
        deliveryState: MessageDeliveryState.delivered,
        orderIndex: 0,
        createdAt: DateTime(2026),
      );

      await tester.pumpWidget(_wrap(MessageBubble(message: message)));
      await tester.pump();
      await tester.pump();
      // Hydrate completes → resolved view.
      expect(find.text('Approved'), findsNothing);
      expect(find.text('Rejected'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing);
    },
  );

  testWidgets('assistant turn groups work log, changed files and copy',
      (tester) async {
    final message = Message(
      id: 'm3',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [
        TextContent('All set.'),
        CommandExecutionContent(
          command: 'flutter test',
          status: CommandStatus.completed,
        ),
        DiffContent(
          filename: 'lib/a.dart',
          diff: '+added line\n-removed line',
          additions: 10,
          deletions: 2,
        ),
      ],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pump();

    // Header, totals and the copy action are visible.
    expect(find.text('Work log'), findsOneWidget);
    expect(find.text('Changed files'), findsOneWidget);
    expect(find.text('+10'), findsOneWidget);
    expect(find.text('−2'), findsOneWidget);
    expect(find.text('Copy response'), findsOneWidget);
    // The work log shows its commands inline (≤ preview), so the single command
    // is already visible; the changed-files section is still collapsed.
    expect(find.textContaining('flutter test'), findsOneWidget);
    expect(find.text('lib/a.dart'), findsNothing);

    // Expanding changed files reveals the file row.
    await tester.tap(find.text('Changed files'));
    await tester.pumpAndSettle();
    expect(find.text('lib/a.dart'), findsOneWidget);
  });

  testWidgets('assistant turn interleaves work logs with responses in order',
      (tester) async {
    final message = Message(
      id: 'm6',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [
        CommandExecutionContent(command: 'ls', status: CommandStatus.completed),
        TextContent('First part.'),
        CommandExecutionContent(
          command: 'cat a',
          status: CommandStatus.completed,
        ),
        TextContent('Second part.'),
      ],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pumpAndSettle();

    // Two separate work logs (one before each response), not one on top.
    expect(find.text('Work log'), findsNWidgets(2));
    expect(find.textContaining('First part.'), findsOneWidget);
    expect(find.textContaining('Second part.'), findsOneWidget);
  });

  testWidgets('assistant turn shows a collapsible thinking section',
      (tester) async {
    final message = Message(
      id: 'm4',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [
        ThinkingContent('weighing the options'),
        TextContent('The answer.'),
      ],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pumpAndSettle();

    // Shown by default but collapsed: header visible, reasoning hidden.
    expect(find.text('Thinking'), findsOneWidget);
    expect(find.text('weighing the options'), findsNothing);
    // The answer renders normally.
    expect(find.text('The answer.'), findsOneWidget);

    await tester.tap(find.text('Thinking'));
    await tester.pumpAndSettle();
    expect(find.text('weighing the options'), findsOneWidget);
  });

  testWidgets('thinking section is hidden when the setting is off',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'uxnan.conversation.showThinking': false,
    });
    final message = Message(
      id: 'm5',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [
        ThinkingContent('hidden reasoning'),
        TextContent('Answer only.'),
      ],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pumpAndSettle();

    expect(find.text('Thinking'), findsNothing);
    expect(find.text('hidden reasoning'), findsNothing);
    expect(find.text('Answer only.'), findsOneWidget);
  });

  testWidgets('tapping a user bubble toggles a copy-message action',
      (tester) async {
    final message = Message(
      id: 'u1',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.user,
      contents: const [TextContent('my prompt')],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pumpAndSettle();

    // Hidden by default.
    expect(find.text('Copy message'), findsNothing);

    // Tap the bubble → the copy action appears.
    await tester.tap(find.byType(MarkdownBody));
    await tester.pumpAndSettle();
    expect(find.text('Copy message'), findsOneWidget);

    // Tap again → it hides.
    await tester.tap(find.byType(MarkdownBody));
    await tester.pumpAndSettle();
    expect(find.text('Copy message'), findsNothing);
  });

  testWidgets('ComposerBar shows a Stop button while running and calls onStop',
      (tester) async {
    var stops = 0;
    await tester.pumpWidget(
      _wrap(
        ComposerBar(
          onSend: (_) {},
          running: true,
          onStop: () => stops++,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.stop_rounded), findsOneWidget);
    expect(find.byIcon(Icons.arrow_upward_rounded), findsNothing);

    await tester.tap(find.byIcon(Icons.stop_rounded));
    await tester.pump();
    expect(stops, 1);
  });

  testWidgets('ComposerBar sends trimmed text and clears the field',
      (tester) async {
    String? sent;
    await tester.pumpWidget(
      _wrap(
        ComposerBar(
          onSend: (text) => sent = text,
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), '  hola  ');
    await tester.pumpAndSettle();
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
          enabled: false,
          onSend: (_) => sentCount++,
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), 'hi');
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.arrow_upward_rounded));
    await tester.pump();

    expect(sentCount, 0);
  });

  testWidgets('ComposerBar dictates recognized speech into the field',
      (tester) async {
    final speech = _FakeSpeech();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [speechToTextServiceProvider.overrideWithValue(speech)],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: ComposerBar(onSend: (_) {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Tap the mic → dictation starts (icon flips to the filled, recording mic).
    await tester.tap(find.byIcon(Icons.mic_none_rounded));
    await tester.pumpAndSettle();
    expect(speech.listening, isTrue);
    expect(find.byIcon(Icons.mic_rounded), findsOneWidget);

    // A partial result streams into the field…
    speech.emit('hola');
    await tester.pumpAndSettle();
    expect(find.text('hola'), findsOneWidget);

    // …and the final result stops the session. With text now in the field the
    // pill swaps the trailing action from mic to Send (NE spec §6.5: the right
    // button is mic when empty, send when there's text).
    speech.emit('hola mundo', isFinal: true);
    await tester.pumpAndSettle();
    expect(find.text('hola mundo'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_upward_rounded), findsOneWidget);
    expect(find.byIcon(Icons.mic_none_rounded), findsNothing);
  });

  testWidgets('ComposerBar warns when voice input is unavailable',
      (tester) async {
    final speech = _FakeSpeech(available: false);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [speechToTextServiceProvider.overrideWithValue(speech)],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: ComposerBar(onSend: (_) {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.mic_none_rounded));
    await tester.pump();

    expect(speech.listening, isFalse);
    expect(
      find.text("Voice input isn't available on this device."),
      findsOneWidget,
    );
  });
}

/// A speech service that never touches the platform — drives dictation results
/// on demand.
class _FakeSpeech extends SpeechToTextService {
  _FakeSpeech({this.available = true});

  final bool available;
  bool listening = false;
  void Function(SpeechResult)? _onResult;

  @override
  bool get isAvailable => available;

  @override
  bool get isListening => listening;

  @override
  Future<bool> initialize() async => available;

  @override
  Future<void> start({
    required void Function(SpeechResult result) onResult,
    String? localeId,
  }) async {
    _onResult = onResult;
    listening = true;
  }

  @override
  Future<void> stop() async => listening = false;

  @override
  Future<void> cancel() async => listening = false;

  void emit(String text, {bool isFinal = false}) =>
      _onResult?.call(SpeechResult(text: text, isFinal: isFinal));
}
