import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_queue_hint.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';

/// A queued user bubble (its corner actions and what they report) and the two
/// marks a message the agent took mid-answer leaves in the timeline.
Message _user(
  String text, {
  String turnId = 'turn-q1',
  MessageDeliveryState state = MessageDeliveryState.queued,
}) =>
    Message(
      id: 'u-$turnId',
      threadId: 'th1',
      turnId: turnId,
      role: MessageRole.user,
      contents: [TextContent(text)],
      deliveryState: state,
      orderIndex: 0,
      createdAt: DateTime(2026),
    );

void main() {
  late UxnanDatabase db;
  late StreamController<DomainEvent> events;
  late ThreadManager manager;

  /// Whether the fake bridge refuses `turn/cancel` (the message stays queued).
  late bool refuseCancel;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    events = StreamController<DomainEvent>.broadcast();
    refuseCancel = false;
    manager = ThreadManager(
      threadRepository: DriftThreadRepository(db),
      messageRepository: DriftMessageRepository(db),
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        if (method == 'turn/cancel' && refuseCancel) {
          return RpcMessage.response(
            id: '1',
            error: const RpcError(code: -32008, message: 'turn not found'),
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
  });

  tearDown(() async {
    await manager.dispose();
    await events.close();
    await db.close();
  });

  /// A thread driven by an agent that takes messages mid-turn.
  const steeringThread = Thread(
    id: 'th1',
    title: 'A thread',
    agentId: 'claude-code',
    syncState: ThreadSyncState.synced,
    status: ThreadStatus.active,
  );
  const steeringAgent = AgentDescriptor(
    agentId: 'claude-code',
    displayName: 'Claude Code',
    available: true,
    capabilities: AgentCapabilities(steering: true),
  );

  /// [activity] decides whether "send now" shows: only with nothing running,
  /// whatever the agent. [steering] puts the thread on an agent that takes
  /// messages mid-turn. [delivering] marks the queued turn the running agent
  /// is taking; its note animates, so the pump does not settle then.
  Future<void> pump(
    WidgetTester tester,
    Widget child, {
    ThreadActivity activity = ThreadActivity.running,
    List<String> queued = const ['turn-q1'],
    bool paused = false,
    String? delivering,
    bool steering = false,
  }) async {
    tester.view.physicalSize = const Size(412, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          threadManagerProvider.overrideWithValue(manager),
          threadQueueForProvider.overrideWith(
            (ref, _) => ThreadQueueState(
              turnIds: queued,
              paused: paused,
              deliveringTurnId: delivering,
            ),
          ),
          threadActivityForProvider.overrideWith((ref, _) => activity),
          // Without [steering] there is no thread record: its agent is
          // unknown, so it takes no message mid-turn — and no database stream
          // outlives the test.
          threadByIdProvider
              .overrideWith((ref, _) => steering ? steeringThread : null),
          agentsProvider.overrideWith(
            (ref) async =>
                steering ? const [steeringAgent] : const <AgentDescriptor>[],
          ),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: ListView(children: [child])),
        ),
      ),
    );
    if (delivering == null) {
      await tester.pumpAndSettle();
    } else {
      await tester.pump(const Duration(milliseconds: 500));
    }
  }

  Finder action(String tooltip) => find.byTooltip(tooltip);

  const longText = 'Also run the whole test suite once the refactor is in, '
      'and tell me which of the flaky ones still fail after the retry.';

  testWidgets('the text never runs under the three corner actions',
      (tester) async {
    await pump(
      tester,
      MessageBubble(message: _user(longText)),
      activity: ThreadActivity.idle,
    );

    expect(action('Send now'), findsOneWidget);
    expect(action('Edit this message'), findsOneWidget);
    expect(action('Cancel this message'), findsOneWidget);
    final text = tester.getRect(find.byType(MarkdownBody));
    final first = tester.getRect(action('Send now'));
    expect(text.right, lessThanOrEqualTo(first.left));
  });

  testWidgets('with two corner actions the text takes the room back',
      (tester) async {
    await pump(tester, MessageBubble(message: _user(longText)));

    expect(action('Send now'), findsNothing);
    final text = tester.getRect(find.byType(MarkdownBody));
    final first = tester.getRect(action('Edit this message'));
    expect(text.right, lessThanOrEqualTo(first.left));
    // Only the room two buttons need is reserved.
    expect(first.left - text.right, lessThan(28));
  });

  testWidgets('send now is hidden while a turn runs, even for a steering agent',
      (tester) async {
    await pump(
      tester,
      MessageBubble(message: _user('and the docs')),
      steering: true,
    );

    // The bridge refuses it for every agent while the agent works: one that
    // takes messages mid-turn gets it at its next pause.
    expect(action('Send now'), findsNothing);
    expect(action('Edit this message'), findsOneWidget);
    expect(action('Cancel this message'), findsOneWidget);
  });

  testWidgets('send now is offered on a held queue with nothing running',
      (tester) async {
    await pump(
      tester,
      MessageBubble(message: _user('and the docs')),
      activity: ThreadActivity.idle,
      paused: true,
    );

    expect(action('Send now'), findsOneWidget);
  });

  testWidgets('the message reaching the agent keeps its place, not its actions',
      (tester) async {
    await pump(
      tester,
      Column(
        children: [
          MessageBubble(message: _user('take this now')),
          MessageBubble(message: _user('and this later', turnId: 'turn-q2')),
        ],
      ),
      queued: const ['turn-q1', 'turn-q2'],
      delivering: 'turn-q1',
      steering: true,
    );

    // The delivering one says it is reaching the agent — no position.
    expect(find.byKey(const ValueKey('queued-delivering-note')), findsOne);
    expect(
      find.text('Reaching the agent, at the end of its current step'),
      findsOneWidget,
    );
    expect(find.text('Next in the queue'), findsNothing);
    // Only the second bubble keeps edit and cancel (and no send now while
    // the turn runs): the first one's have faded and take no taps.
    expect(action('Edit this message').hitTestable(), findsOneWidget);
    expect(action('Cancel this message').hitTestable(), findsOneWidget);
    expect(action('Send now').hitTestable(), findsNothing);
    expect(
      tester.getRect(action('Edit this message').hitTestable()).top,
      greaterThan(tester.getRect(find.text('take this now')).bottom),
    );
    expect(find.text('2 in the queue'), findsOneWidget);
  });

  testWidgets('a cancel the bridge refuses says so', (tester) async {
    refuseCancel = true;
    await pump(tester, MessageBubble(message: _user('never mind')));

    await tester.tap(action('Cancel this message'));
    await tester.pumpAndSettle();

    expect(find.text("Couldn't cancel that message"), findsOneWidget);
  });

  testWidgets('an edit the bridge refuses says so and keeps the message',
      (tester) async {
    refuseCancel = true;
    await pump(tester, MessageBubble(message: _user('reword me')));

    await tester.tap(action('Edit this message'));
    await tester.pumpAndSettle();

    expect(find.text("Couldn't take that message back"), findsOneWidget);
    expect(find.text('reword me'), findsOneWidget);
  });

  testWidgets('a message taken mid-answer says it reached the agent',
      (tester) async {
    await pump(
      tester,
      MessageBubble(
        message: _user(
          'also keep the tests',
          turnId: 'tB',
          state: MessageDeliveryState.sent,
        ),
        steered: true,
      ),
      queued: const [],
    );

    expect(find.byKey(const ValueKey('steered-note')), findsOneWidget);
    expect(
      find.text('Reached the agent while it was working'),
      findsOneWidget,
    );
  });

  testWidgets('an ordinary sent message carries no steering note',
      (tester) async {
    await pump(
      tester,
      MessageBubble(
        message: _user(
          'hello',
          turnId: 'tB',
          state: MessageDeliveryState.sent,
        ),
      ),
      queued: const [],
    );

    expect(find.byKey(const ValueKey('steered-note')), findsNothing);
  });

  testWidgets('a reply cut by a later message says it continues below',
      (tester) async {
    final answer = Message(
      id: 'stream-tA',
      threadId: 'th1',
      turnId: 'tA',
      role: MessageRole.assistant,
      contents: const [TextContent('Reading the parser first.')],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 1,
      createdAt: DateTime(2026),
      continuedIn: 'tB',
    );
    await pump(tester, MessageBubble(message: answer), queued: const []);

    // The answer so far stays whole, with the line after it.
    expect(find.text('Reading the parser first.'), findsOneWidget);
    expect(
      find.text('Continues below, with your next message'),
      findsOneWidget,
    );
    final answerRect = tester.getRect(find.text('Reading the parser first.'));
    expect(
      tester.getRect(find.text('Continues below, with your next message')).top,
      greaterThan(answerRect.bottom),
    );
  });

  testWidgets('a reply that ended on its own has no continuation line',
      (tester) async {
    final answer = Message(
      id: 'stream-tA',
      threadId: 'th1',
      turnId: 'tA',
      role: MessageRole.assistant,
      contents: const [TextContent('All done.')],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 1,
      createdAt: DateTime(2026),
    );
    await pump(tester, MessageBubble(message: answer), queued: const []);

    expect(find.text('Continues below, with your next message'), findsNothing);
  });

  group('composer hint while the agent works', () {
    Future<void> pumpHint(WidgetTester tester, {required bool steering}) =>
        pump(
          tester,
          const ComposerQueueHint(threadId: 'th1'),
          queued: const [],
          steering: steering,
        );

    testWidgets('a steering agent gets it at its next pause, queue empty',
        (tester) async {
      await pumpHint(tester, steering: true);

      expect(
        find.text(
          'The agent is working: this message waits in the queue and '
          'reaches it at its next pause.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('any other agent gets it when the turn ends', (tester) async {
      await pumpHint(tester, steering: false);

      expect(
        find.text(
          'The agent is working: this message waits in the queue and goes '
          'out when it finishes.',
        ),
        findsOneWidget,
      );
    });
  });
}
