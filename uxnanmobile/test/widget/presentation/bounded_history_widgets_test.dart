import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/rpc_exception.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/entities/step_page.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/repositories/i_turn_detail_repository.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_bubble.dart';
import 'package:uxnan/presentation/screens/conversation/messages/turn_detail_screen.dart';

/// Answers the detail methods like the bridge: steps by stored index.
class _Repository implements ITurnDetailRepository {
  _Repository({this.steps = const {}, this.error});

  final Map<int, MessageContent> steps;
  final RpcException? error;
  final List<String> asked = [];

  @override
  Future<StepPage> readSteps(
    String threadId,
    String turnId, {
    required int from,
    required int to,
    bool fresh = false,
  }) async {
    asked.add('steps $from..$to');
    if (error case final failure?) throw failure;
    final indexes = steps.keys.where((i) => i >= from && i <= to).toList()
      ..sort();
    final page = indexes.take(2).toList();
    return StepPage(
      steps: [for (final i in page) steps[i]!],
      next: indexes.length > 2 ? indexes[2] : null,
    );
  }

  @override
  Future<MessageContent> readStep(
    String threadId,
    String turnId,
    int index,
  ) async {
    asked.add('step $index');
    if (error case final failure?) throw failure;
    return steps[index]!;
  }
}

Message _reply(List<MessageContent> contents) => Message(
      id: 'stream-t1',
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: contents,
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 1,
      createdAt: DateTime(2026),
    );

Widget _app(
  Widget child, {
  required _Repository repository,
  required Stream<ConnectionPhase> phase,
}) =>
    ProviderScope(
      overrides: [
        turnDetailRepositoryProvider.overrideWithValue(repository),
        connectionPhaseProvider.overrideWith((ref) => phase),
      ],
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    );

CommandExecutionContent _cmd(int index, {String? output}) =>
    CommandExecutionContent(
      command: 'step $index',
      status: CommandStatus.completed,
      output: output,
      index: index,
    );

const _run = WorkRunContent(
  from: 1,
  to: 5,
  commands: 3,
  edits: 1,
  files: [ChangedFileSummary(filename: 'lib/a.dart', additions: 4)],
  last: CommandExecutionContent(
    command: 'step 5',
    status: CommandStatus.completed,
    index: 5,
  ),
);

void main() {
  testWidgets('a summarized run reads its steps from the bridge when opened',
      (tester) async {
    final repository = _Repository(
      steps: {
        1: _cmd(1),
        2: const DiffContent(filename: 'lib/a.dart', diff: '', index: 2),
        4: _cmd(4),
        5: _cmd(5),
      },
    );
    await tester.pumpWidget(
      _app(
        MessageBubble(
          message: _reply(const [_run, TextContent('Done.')]),
        ),
        repository: repository,
        phase: Stream.value(ConnectionPhase.connected),
      ),
    );
    await tester.pumpAndSettle();

    // Settled: the work folds behind one line, the answer stays.
    expect(find.text('Work log'), findsNothing);
    await tester.tap(find.text('Show the work'));
    await tester.pumpAndSettle();

    // Collapsed: three listed steps (its edit is a changed file), the last
    // command — and nothing asked of the bridge.
    expect(find.text('Work log'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.text(r'$ step 5'), findsOneWidget);
    expect(find.text('Changed files'), findsOneWidget);
    expect(repository.asked, isEmpty);

    await tester.tap(find.text('Work log'));
    await tester.pumpAndSettle();
    expect(repository.asked, ['steps 1..5']);
    expect(find.text(r'$ step 1'), findsOneWidget);
    // The edit is not a log row.
    expect(find.text('lib/a.dart'), findsNothing);

    await tester.tap(find.text('Show more steps'));
    await tester.pumpAndSettle();
    expect(repository.asked, ['steps 1..5', 'steps 4..5']);
    expect(find.text(r'$ step 4'), findsOneWidget);
    expect(find.text('Show more steps'), findsNothing);
  });

  testWidgets('offline, an opened run says what it was and loads on connect',
      (tester) async {
    final repository = _Repository(steps: {1: _cmd(1), 5: _cmd(5)});
    final phase = StreamController<ConnectionPhase>();
    addTearDown(phase.close);
    phase.add(ConnectionPhase.disconnected);
    await tester.pumpWidget(
      _app(
        MessageBubble(
          message: _reply(const [_run, TextContent('Done.')]),
          running: true,
        ),
        repository: repository,
        phase: phase.stream,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Work log'));
    await tester.pumpAndSettle();

    expect(find.text('3 commands'), findsOneWidget);
    expect(
      find.text('The steps load when your computer is connected.'),
      findsOneWidget,
    );
    expect(repository.asked, isEmpty);

    phase.add(ConnectionPhase.connected);
    await tester.pumpAndSettle();
    expect(repository.asked, ['steps 1..5']);
    expect(find.text(r'$ step 1'), findsOneWidget);
  });

  testWidgets('a run whose last step is an edit names the file', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        MessageBubble(
          message: _reply(const [
            WorkRunContent(
              from: 0,
              to: 1,
              commands: 1,
              edits: 1,
              files: [ChangedFileSummary(filename: 'lib/deep/b.dart')],
              last: DiffContent(
                filename: 'lib/deep/b.dart',
                diff: '',
                index: 1,
              ),
            ),
          ]),
          running: true,
        ),
        repository: _Repository(),
        phase: Stream.value(ConnectionPhase.connected),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Edited b.dart'), findsOneWidget);
  });

  testWidgets('a refused page of steps says it is too large', (tester) async {
    await tester.pumpWidget(
      _app(
        MessageBubble(
          message: _reply(const [_run, TextContent('Done.')]),
          running: true,
        ),
        repository: _Repository(
          error: const RpcException(
            RpcException.responseTooLarge,
            'Response too large',
          ),
        ),
        phase: Stream.value(ConnectionPhase.connected),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Work log'));
    await tester.pumpAndSettle();
    expect(
      find.text('This is too large to send to your phone.'),
      findsOneWidget,
    );
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets(
      "a cut command shows its output's end and opens the whole of it "
      'lazily', (tester) async {
    final whole = List.generate(5000, (i) => 'line $i').join('\n');
    final repository = _Repository(
      steps: {
        3: CommandExecutionContent(
          command: 'make all',
          status: CommandStatus.completed,
          output: whole,
          exitCode: 0,
          index: 3,
        ),
      },
    );
    await tester.pumpWidget(
      _app(
        MessageBubble(
          message: _reply(const [
            CommandExecutionContent(
              command: 'make all',
              status: CommandStatus.completed,
              output: 'line 4999',
              outputChars: 48000,
              index: 3,
            ),
          ]),
          running: true,
        ),
        repository: repository,
        phase: Stream.value(ConnectionPhase.connected),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Work log'));
    await tester.pumpAndSettle();
    await tester.tap(find.text(r'$ make all'));
    await tester.pumpAndSettle();
    expect(find.text('Last 9 of 48,000 characters'), findsOneWidget);

    await tester.tap(find.text('Show full output'));
    await tester.pumpAndSettle();
    expect(repository.asked, ['step 3']);
    expect(find.byType(TurnDetailScreen), findsOneWidget);
    expect(find.text('Output · Exit code 0'), findsOneWidget);
    expect(find.text('line 0'), findsOneWidget);
    // Lazily built: the last line is not laid out until scrolled to.
    expect(find.text('line 4999'), findsNothing);
    expect(
      tester.widgetList(find.byType(Text)).length,
      lessThan(200),
    );
  });

  testWidgets("a changed file opens its edits' diff, read from its run", (
    tester,
  ) async {
    final repository = _Repository(
      steps: {
        1: _cmd(1),
        2: const DiffContent(
          filename: 'lib/a.dart',
          diff: '@@ -1 +1 @@\n-old\n+new',
          additions: 4,
          index: 2,
        ),
      },
    );
    await tester.pumpWidget(
      _app(
        MessageBubble(
          message: _reply(const [_run, TextContent('Done.')]),
          running: true,
        ),
        repository: repository,
        phase: Stream.value(ConnectionPhase.connected),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Changed files'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('lib/a.dart'));
    await tester.pumpAndSettle();
    expect(repository.asked, ['steps 1..5', 'step 2']);
    expect(find.text('a.dart'), findsOneWidget);
    expect(find.text('+new'), findsOneWidget);
    expect(find.text('-old'), findsOneWidget);
  });

  testWidgets(
      'a thought is a log row: one line, opened in place, cut opens whole',
      (tester) async {
    final repository = _Repository(
      steps: {2: const ThinkingContent('the whole thought', index: 2)},
    );
    await tester.pumpWidget(
      _app(
        MessageBubble(
          running: true,
          message: _reply([
            _cmd(1),
            ThinkingContent(
              'Weighing **two** options\nfor the fix. ${'r' * 600}',
              index: 2,
              textChars: 9000,
            ),
            _cmd(3),
            const TextContent('Answer.'),
          ]),
        ),
        repository: repository,
        phase: Stream.value(ConnectionPhase.connected),
      ),
    );
    await tester.pumpAndSettle();
    // One work log holds the commands and the thought between them; the
    // turn has no reasoning block of its own.
    expect(find.text('Work log'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    await tester.tap(find.text('Work log'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Thought', findRichText: true), findsOneWidget);
    expect(
      find.textContaining(
        'Weighing **two** options for the fix.',
        findRichText: true,
      ),
      findsOneWidget,
    );

    await tester.tap(find.textContaining('Thought', findRichText: true));
    await tester.pumpAndSettle();
    expect(find.textContaining('Weighing', findRichText: true), findsWidgets);
    await tester.tap(find.text('Show full thought'));
    await tester.pumpAndSettle();
    expect(repository.asked, ['step 2']);
    expect(find.text('the whole thought'), findsOneWidget);
  });

  testWidgets('a thought being written shows as Thinking, and follows its end',
      (tester) async {
    Widget reply(String text) => _app(
          MessageBubble(
            running: true,
            message: _reply([
              _cmd(1),
              ThinkingContent(text, isStreaming: true),
            ]),
          ),
          repository: _Repository(),
          phase: Stream.value(ConnectionPhase.connected),
        );
    final long = List.generate(40, (i) => 'line $i').join('\n\n');
    await tester.pumpWidget(reply(long));
    await tester.pump(const Duration(milliseconds: 300));
    // Collapsed, the log's line says the agent is thinking now.
    expect(find.text('Thinking…'), findsOneWidget);
    await tester.tap(find.text('Work log'));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.tap(find.text('Thinking'));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    final scroll = tester
        .widgetList<SingleChildScrollView>(find.byType(SingleChildScrollView))
        .singleWhere((view) => view.controller != null);
    final controller = scroll.controller!;
    expect(controller.offset, controller.position.maxScrollExtent);
    expect(controller.position.maxScrollExtent, greaterThan(0));

    // It grows: the box stays on its newest text.
    await tester.pumpWidget(reply('$long\n\nline 40\n\nline 41'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(controller.offset, controller.position.maxScrollExtent);
  });

  testWidgets('the detail screen waits for the computer, then loads', (
    tester,
  ) async {
    final repository = _Repository(
      steps: {4: const ThinkingContent('later', index: 4)},
    );
    final phase = StreamController<ConnectionPhase>();
    addTearDown(phase.close);
    phase.add(ConnectionPhase.disconnected);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          turnDetailRepositoryProvider.overrideWithValue(repository),
          connectionPhaseProvider.overrideWith((ref) => phase.stream),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: TurnDetailScreen(
            request: StepDetailRequest(
              threadId: 'th1',
              turnId: 't1',
              step: ThinkingContent('start', index: 4, textChars: 900),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Connect to your computer to see this.'), findsOneWidget);
    expect(repository.asked, isEmpty);

    phase.add(ConnectionPhase.connected);
    await tester.pumpAndSettle();
    expect(find.text('later'), findsOneWidget);
  });
}
