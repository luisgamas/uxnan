import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/thread_preview_provider.dart';
import 'package:uxnan/presentation/screens/threads/threads_screen.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/agent_status_indicator.dart';

Thread _thread(
  String id,
  String title,
  String agentId, {
  String? cwd,
  String? projectId,
}) =>
    Thread(
      id: id,
      title: title,
      agentId: agentId,
      syncState: ThreadSyncState.synced,
      status: ThreadStatus.active,
      lastActivity: DateTime(2026, 6, 6, 10, 30),
      cwd: cwd,
      projectId: projectId,
    );

Widget _wrap({
  required List<Thread> threads,
  Map<String, ThreadActivity> activity = const {},
  List<Project> projects = const [],
}) {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, __) => const ThreadsScreen(deviceId: 'mac-1'),
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      // The row's reply preview reads the message store; a list test has no
      // database, and pulling the real one in leaves drift timers pending.
      threadPreviewProvider.overrideWith((ref, key) async => null),
      threadsProvider.overrideWith((ref) => Stream.value(threads)),
      // The list is grouped by project now, so the screen reads the bridge's
      // roots. Feeding them keeps the real request (and its transport) out.
      projectsProvider.overrideWith((ref) async => projects),
      // A held queue is one of the things that blocks a thread, so the
      // queue stream is part of the row's state too.
      threadQueuesProvider.overrideWith(
        (ref) => Stream.value(const <String, ThreadQueueState>{}),
      ),
      // The row's state now includes "the agent asked and is waiting on
      // you", which the manager tracks; feed it directly so the real one
      // (drift, transport, its poll timers) stays out of a widget test.
      awaitingInputProvider.overrideWith(
        (ref) => Stream.value(const <String, Set<String>>{}),
      ),
      threadActivityProvider.overrideWith((ref) => Stream.value(activity)),
      unreadThreadsProvider.overrideWith(
        (ref) => Stream.value(const <String>{}),
      ),
      // No live bridge in the widget test: report no auth info so tiles keep
      // their normal status dot (the real provider would hit the session).
      authStatusProvider.overrideWith((ref, agentId) => null),
      trustedDevicesProvider
          .overrideWith((ref) => Stream.value(const <TrustedDevice>[])),
      connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
      connectingDeviceProvider.overrideWith((ref) => Stream.value(null)),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    ),
  );
}

void main() {
  testWidgets('renders a tile per thread with agent filter chips', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Fix the login bug', 'codex'),
          _thread('b', 'Add dark mode', 'claude-code'),
        ],
      ),
    );
    await tester.pump();

    expect(find.text('Fix the login bug'), findsOneWidget);
    expect(find.text('Add dark mode'), findsOneWidget);
    // One chip per agent. No "All": a FilterChip toggles off, and "all" is
    // simply none of them selected — a chip for it would be a second way to
    // express the same state.
    expect(find.widgetWithText(FilterChip, 'Codex'), findsOneWidget);
    expect(find.widgetWithText(FilterChip, 'Claude Code'), findsOneWidget);
    // …and the state chips, which are the question that brings you here.
    expect(find.widgetWithText(FilterChip, 'Waiting for you'), findsOneWidget);
  });

  testWidgets('filters threads when an agent chip is selected', (tester) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Fix the login bug', 'codex'),
          _thread('b', 'Add dark mode', 'claude-code'),
        ],
      ),
    );
    await tester.pump();

    await tester.tap(find.widgetWithText(FilterChip, 'Codex'));
    await tester.pumpAndSettle();

    expect(find.text('Fix the login bug'), findsOneWidget);
    expect(find.text('Add dark mode'), findsNothing);
  });

  testWidgets('shows the empty state when there are no threads', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(threads: const []));
    await tester.pump();

    expect(find.text('No threads yet'), findsOneWidget);
  });

  testWidgets('long-pressing a thread opens the actions menu', (tester) async {
    await tester.pumpWidget(
      _wrap(threads: [_thread('th-9', 'Fix the login bug', 'codex')]),
    );
    await tester.pump();

    await tester.longPress(find.text('Fix the login bug'));
    await tester.pumpAndSettle();

    expect(find.text('Rename'), findsOneWidget);
    expect(find.text('Copy thread ID'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);
    // The sheet header shows the thread id for reference.
    expect(find.text('th-9'), findsOneWidget);
  });

  testWidgets('a state chip narrows the list and clears by tapping again',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Fix the login bug', 'codex'),
          _thread('b', 'Add dark mode', 'claude-code'),
        ],
        activity: const {'a': ThreadActivity.running},
      ),
    );
    await tester.pump();
    await tester.pump();

    // `pumpAndSettle` would hang here: a working agent draws the app's looping
    // loader, which never settles by design.
    await tester.tap(find.widgetWithText(FilterChip, 'Working'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Fix the login bug'), findsOneWidget);
    expect(find.text('Add dark mode'), findsNothing);

    // Toggling the same chip is how you get back to everything.
    await tester.tap(find.widgetWithText(FilterChip, 'Working'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Add dark mode'), findsOneWidget);
  });

  testWidgets('filtering everything away offers a way back', (tester) async {
    await tester.pumpWidget(
      _wrap(threads: [_thread('a', 'Fix the login bug', 'codex')]),
    );
    await tester.pump();
    await tester.pump();

    await tester.tap(find.widgetWithText(FilterChip, 'Waiting for you'));
    await tester.pumpAndSettle();
    // An empty PC and a filtered-out list are different dead ends; only this
    // one has a button.
    expect(find.text('No space matches these filters'), findsOneWidget);

    await tester.tap(find.text('Clear filters'));
    await tester.pumpAndSettle();
    expect(find.text('Fix the login bug'), findsOneWidget);
  });

  testWidgets('a row reads state, then who, then what', (tester) async {
    await tester
        .pumpWidget(_wrap(threads: [_thread('t1', 'Claude', 'Fix it')]));
    await tester.pumpAndSettle();

    // The order `uxnandesktop` reads in, and the order the eye needs: whether a
    // row wants you decides whether you read the rest of it.
    final indicator = tester.getTopLeft(find.byType(AgentStatusIndicator)).dx;
    final logo = tester.getTopLeft(find.byType(AgentLogo)).dx;
    final title = tester.getTopLeft(find.text('Claude')).dx;
    expect(indicator, lessThan(logo));
    expect(logo, lessThan(title));

    // The mark identifies and the indicator only signals, so the mark is the
    // larger of the two — and neither is a 44 dp avatar competing with the
    // text beside it.
    expect(
      tester.getSize(find.byType(AgentLogo)).width,
      greaterThan(tester.getSize(find.byType(AgentStatusIndicator)).width),
    );
  });

  testWidgets('agent marks carry no border and no shadow', (tester) async {
    await tester
        .pumpWidget(_wrap(threads: [_thread('t1', 'Claude', 'Fix it')]));
    await tester.pumpAndSettle();

    // A framed, shadowed tile inside a card read as the CARD having a shadow —
    // which is what it looked like, and why this is asserted rather than
    // trusted.
    final boxes = tester.widgetList<Container>(
      find.descendant(
        of: find.byType(AgentLogo),
        matching: find.byType(Container),
      ),
    );
    for (final box in boxes) {
      final decoration = box.decoration;
      if (decoration is! BoxDecoration) continue;
      expect(decoration.border, isNull);
      expect(decoration.boxShadow, anyOf(isNull, isEmpty));
    }
  });

  group('the hierarchy', () {
    Thread inFolder(String id, String title, String cwd) => Thread(
          id: id,
          title: title,
          agentId: 'claude-code',
          syncState: ThreadSyncState.synced,
          status: ThreadStatus.active,
          cwd: cwd,
        );

    testWidgets('a project heads its folders, which head their conversations',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          projects: const [Project(id: 'p', name: 'uxnan', cwd: '/dev/uxnan')],
          threads: [
            inFolder('a', 'Fix login', '/dev/uxnan/app'),
            inFolder('b', 'Dark mode', '/dev/uxnan/web'),
          ],
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.text('uxnan'), findsOneWidget);
      expect(find.text('app'), findsOneWidget);
      expect(find.text('web'), findsOneWidget);
      expect(find.text('Fix login'), findsOneWidget);
    });

    testWidgets('closing a project hides its contents but not its state',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          projects: const [Project(id: 'p', name: 'uxnan', cwd: '/dev/uxnan')],
          threads: [inFolder('a', 'Fix login', '/dev/uxnan/app')],
        ),
      );
      await tester.pump();
      await tester.pump();

      await tester.tap(find.text('uxnan'));
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Fix login'), findsNothing);
      expect(find.text('app'), findsNothing);
      // A closed project still reports what is happening inside it — otherwise
      // closing one hides the very thing the screen exists for.
      expect(find.byType(AgentStatusIndicator), findsWidgets);
    });

    testWidgets('closing a folder hides only its own conversations',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          projects: const [Project(id: 'p', name: 'uxnan', cwd: '/dev/uxnan')],
          threads: [
            inFolder('a', 'Fix login', '/dev/uxnan/app'),
            inFolder('b', 'Dark mode', '/dev/uxnan/web'),
          ],
        ),
      );
      await tester.pump();
      await tester.pump();

      await tester.tap(find.text('app'));
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Fix login'), findsNothing);
      expect(find.text('Dark mode'), findsOneWidget);
    });

    testWidgets('long-pressing a folder opens its details with the full path',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          projects: const [Project(id: 'p', name: 'uxnan', cwd: '/dev/uxnan')],
          threads: [inFolder('a', 'Fix login', '/dev/uxnan/app')],
        ),
      );
      await tester.pump();
      await tester.pump();

      await tester.longPress(find.text('app'));
      await tester.pump(const Duration(milliseconds: 400));

      // The row is one line by design; the path it cannot show lives here.
      expect(find.text('/dev/uxnan/app'), findsOneWidget);
      expect(find.text('Copy path'), findsOneWidget);
    });

    testWidgets('work outside every root still appears, in its own group',
        (tester) async {
      // A sibling worktree matches no configured root. It must not vanish.
      await tester.pumpWidget(
        _wrap(
          projects: const [Project(id: 'p', name: 'uxnan', cwd: '/dev/uxnan')],
          threads: [inFolder('a', 'On a branch', '/dev/uxnan--feature')],
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.text('Other spaces'), findsOneWidget);
      expect(find.text('On a branch'), findsOneWidget);
    });
  });
}
