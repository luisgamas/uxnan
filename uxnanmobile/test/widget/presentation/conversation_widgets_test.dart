import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
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

  testWidgets('streaming assistant turn shows a compact responding cue',
      (tester) async {
    final message = Message(
      id: 'streaming',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [TextContent('Working', isStreaming: true)],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Agent responding…'), findsOneWidget);
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
    // The SubagentCard is collapsed by default: its actions are revealed only
    // after tapping the header to expand it.
    expect(find.text('Read main.dart'), findsNothing);
    await tester.tap(find.text('reviewer'));
    await tester.pumpAndSettle();
    expect(find.text('Read main.dart'), findsOneWidget);
    // The approval card renders its interactive Approve action (disabled here
    // only because this bubble has no owning thread to respond through).
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

  testWidgets('renders a question card with its options and actions',
      (tester) async {
    final message = Message(
      id: 'm-question',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [
        QuestionContent(
          QuestionRequest(
            questionId: 'q1',
            questions: [
              QuestionItem(
                question: 'Which language do you prefer?',
                header: 'Language',
                options: [
                  QuestionOption(label: 'Python', description: 'batteries'),
                  QuestionOption(label: 'JavaScript'),
                ],
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

    expect(find.text('Needs your answer'), findsOneWidget);
    expect(find.text('Language'), findsOneWidget);
    expect(find.text('Which language do you prefer?'), findsOneWidget);
    expect(find.text('Python'), findsOneWidget);
    expect(find.text('JavaScript'), findsOneWidget);
    expect(find.text('batteries'), findsOneWidget);
    // Submit is present but disabled until an option is chosen; Skip enabled.
    expect(find.widgetWithText(FilledButton, 'Submit'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Skip'), findsOneWidget);
    final submit = tester
        .widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit'));
    expect(submit.onPressed, isNull, reason: 'disabled with no selection');

    // Picking an option enables Submit.
    await tester.tap(find.text('Python'));
    await tester.pump();
    final submitAfter = tester
        .widget<FilledButton>(find.widgetWithText(FilledButton, 'Submit'));
    expect(submitAfter.onPressed, isNotNull, reason: 'enabled once chosen');
  });

  testWidgets(
    'a resolved question card stays resolved after restart '
    '(options gone, chosen labels shown, answers persist in the store)',
    (tester) async {
      // Pre-seed the store as if the user already answered in a prior session.
      SharedPreferences.setMockInitialValues({
        'uxnan.question.responses':
            '{"q1":{"answers":[["Python"]],"answeredAtMs":1700000000000}}',
      });
      addTearDown(() => SharedPreferences.setMockInitialValues({}));

      final message = Message(
        id: 'm-q-resolved',
        threadId: 'th1',
        turnId: 't1',
        role: MessageRole.assistant,
        contents: const [
          QuestionContent(
            QuestionRequest(
              questionId: 'q1',
              questions: [
                QuestionItem(
                  question: 'Which language do you prefer?',
                  header: 'Language',
                  options: [
                    QuestionOption(label: 'Python'),
                    QuestionOption(label: 'JavaScript'),
                  ],
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
      // Two pumps: build, then let hydrate() resolve and rebuild resolved.
      await tester.pump();
      await tester.pump();

      // The "Answer recorded" title replaces the actionable headline.
      expect(find.text('Needs your answer'), findsNothing);
      expect(find.text('Answer recorded'), findsOneWidget);
      // The action buttons are GONE — an answered card can't be re-answered.
      expect(find.widgetWithText(FilledButton, 'Submit'), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Skip'), findsNothing);
      // The chosen label + the "Answered" timestamp are shown; the unchosen
      // option is no longer an interactive row.
      expect(find.text('Python'), findsOneWidget);
      expect(find.textContaining('Answered'), findsOneWidget);
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
          output: 'All tests passed',
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
    // Each disclosure owns a clipped Material surface, so InkWell paints its
    // ripple inside the same rounded shape instead of the page-level rectangle.
    for (final label in ['Work log', 'Changed files']) {
      final materials = tester.widgetList<Material>(
        find.ancestor(of: find.text(label), matching: find.byType(Material)),
      );
      expect(
        materials.any(
          (material) =>
              material.clipBehavior == Clip.antiAlias &&
              material.shape is RoundedRectangleBorder,
        ),
        isTrue,
        reason: '$label must clip its Material ink response',
      );
    }
    // The compact work-log summary keeps the latest command visible, but its
    // output and the changed-files rows remain collapsed.
    expect(find.textContaining('flutter test'), findsOneWidget);
    expect(find.text('All tests passed'), findsNothing);
    expect(find.text('lib/a.dart'), findsNothing);

    await tester.tap(find.text('Work log'));
    await tester.pumpAndSettle();
    expect(find.text('All tests passed'), findsOneWidget);

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

  testWidgets('assistant process disclosures expand exclusively per turn',
      (tester) async {
    final message = Message(
      id: 'm-process',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: const [
        ThinkingContent('private reasoning detail'),
        CommandExecutionContent(
          command: 'dart analyze',
          status: CommandStatus.completed,
          output: 'No issues found',
        ),
        TextContent('Finished.'),
      ],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Thinking'));
    await tester.pumpAndSettle();
    expect(find.text('private reasoning detail'), findsOneWidget);
    expect(find.text('No issues found'), findsNothing);

    await tester.tap(find.text('Work log'));
    await tester.pumpAndSettle();
    expect(find.text('private reasoning detail'), findsNothing);
    expect(find.text('No issues found'), findsOneWidget);
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

  testWidgets('long user messages collapse, re-expand and copy full text',
      (tester) async {
    tester.view.physicalSize = const Size(800, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    String? copiedText;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copiedText =
            (call.arguments as Map<Object?, Object?>)['text'] as String?;
      }
      return null;
    });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null),
    );

    final fullText = List.generate(
      24,
      (index) => 'Detailed prompt line ${index + 1}',
    ).join('\n');
    final message = Message(
      id: 'u-long',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.user,
      contents: [TextContent(fullText)],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

    await tester.pumpWidget(_wrap(MessageBubble(message: message)));
    await tester.pumpAndSettle();

    expect(find.text('Show more'), findsOneWidget);
    expect(find.text('Show less'), findsNothing);

    await tester.tap(find.text('Show more'));
    await tester.pumpAndSettle();
    expect(find.text('Show less'), findsOneWidget);

    await tester.tapAt(
      tester.getTopLeft(find.byType(MarkdownBody)) + const Offset(4, 4),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Copy message'));
    await tester.pumpAndSettle();
    expect(copiedText, fullText);

    await tester.tap(find.text('Show less'));
    await tester.pumpAndSettle();
    expect(find.text('Show more'), findsOneWidget);
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
    // Dictation remains available while Send occupies its own primary slot.
    expect(find.byIcon(Icons.mic_none_rounded), findsOneWidget);
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

  testWidgets('ComposerBar autofocuses the text field on first build',
      (tester) async {
    await tester.pumpWidget(_wrap(ComposerBar(onSend: (_) {})));
    await tester.pumpAndSettle();

    // The TextField is created with autofocus: true so the keyboard pops up
    // the moment the conversation is opened. The tap-outside-to-unfocus
    // behavior (FocusScope.unfocus in ConversationScreen's GestureDetector)
    // is unchanged by this flag — autofocus only seeds the initial focus, the
    // user can still dismiss it by tapping the timeline.
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.autofocus, isTrue);
    // The EditableText it owns should hold primary focus.
    final editable = tester.widget<EditableText>(find.byType(EditableText));
    expect(editable.focusNode.hasPrimaryFocus, isTrue);
  });

  testWidgets('ComposerBar contracts when idle and stretches on focus',
      (tester) async {
    await tester.pumpWidget(_wrap(ComposerBar(onSend: (_) {})));
    await tester.pumpAndSettle();

    final surface = find.byKey(const ValueKey('composer-surface'));
    final focusedSize = tester.getSize(surface);

    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    final idleSize = tester.getSize(surface);

    expect(idleSize.width, lessThan(focusedSize.width));
    expect(idleSize.height, lessThan(focusedSize.height));
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

    // …and the final result stops the session. Send appears in its own slot,
    // while the mic remains available to continue dictating later.
    speech.emit('hola mundo', isFinal: true);
    await tester.pumpAndSettle();
    expect(find.text('hola mundo'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_upward_rounded), findsOneWidget);
    expect(find.byIcon(Icons.mic_none_rounded), findsOneWidget);
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
