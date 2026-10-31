import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/auth_status.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/threads/conversation_catalog_screen.dart';
import 'package:uxnan/presentation/screens/threads/new_conversation_screen.dart';

List<Override> _baseOverrides({
  bool requiresLogin = false,
  List<AgentDescriptor>? agents,
  List<AgentModel> models = const [],
  String? home,
  List<Thread> threads = const [],
}) {
  return [
    bridgeHomeProvider.overrideWith((ref) => Stream.value(home)),
    threadsProvider.overrideWith((ref) => Stream.value(threads)),
    connectedDeviceProvider.overrideWith((ref) => Stream.value(_pc)),
    projectsProvider.overrideWith(
      (ref, deviceId) => Stream.value(
        const [
          Project(id: 'p1', name: 'App', cwd: '/app'),
          Project(id: 'p2', name: 'Site', cwd: '/site'),
        ],
      ),
    ),
    agentsProvider.overrideWith(
      (ref) async =>
          agents ??
          const [
            AgentDescriptor(
              agentId: 'codex',
              displayName: 'Codex',
              available: true,
              capabilities: AgentCapabilities(
                accessModes: [ApprovalMode.plan],
                streaming: true,
                approvals: true,
                images: true,
              ),
            ),
            AgentDescriptor(
              agentId: 'claude-code',
              displayName: 'Claude Code',
              available: true,
              capabilities: AgentCapabilities(
                accessModes: [ApprovalMode.plan],
                forking: true,
              ),
            ),
          ],
    ),
    agentModelsProvider.overrideWith((ref, id) async => models),
    authStatusProvider.overrideWith(
      (ref, agentId) async => AuthStatus(
        agentId: agentId,
        requiresLogin: requiresLogin && agentId == 'codex',
        loginInProgress: false,
      ),
    ),
  ];
}

Widget _app(Widget home) => MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: home,
    );

Widget _wrap({
  required bool requiresLogin,
  List<AgentDescriptor>? agents,
  List<AgentModel> models = const [],
  String? home,
  String? initialCwd,
  AgentSessionList? sessions,
  List<Thread> threads = const [],
}) {
  return ProviderScope(
    overrides: [
      ..._baseOverrides(
        requiresLogin: requiresLogin,
        agents: agents,
        models: models,
        home: home,
        threads: threads,
      ),
      if (sessions != null) ...[
        agentSessionsProvider
            .overrideWith((ref, cwd) => Stream.value(sessions)),
        agentSessionHoldsProvider.overrideWith((ref) => Stream.value(const {})),
      ],
    ],
    child: _app(NewConversationScreen(initialCwd: initialCwd)),
  );
}

/// Agent cards are visible directly in the full-screen dialog; tapping one
/// selects it without opening a second modal surface.
Future<void> _selectCodex(WidgetTester tester) async {
  await tester.tap(find.text('Codex'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('agent cards are visible directly in the full-screen dialog', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap(requiresLogin: false));
    await tester.pumpAndSettle();

    expect(find.text('New conversation'), findsOneWidget);
    expect(find.text('Codex'), findsOneWidget);
    expect(find.text('Claude Code'), findsOneWidget);
    expect(find.text('Streaming'), findsNothing);
    expect(find.text('Approvals'), findsNothing);
    expect(find.text('Select an agent'), findsNothing);
  });

  group('the folder it runs in', () {
    void tallView(WidgetTester tester) {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
    }

    Finder toggle(String tooltip) => find.byTooltip(tooltip);

    testWidgets("opens on the PC's start folder, the rest folded away", (
      tester,
    ) async {
      tallView(tester);
      await tester.pumpWidget(_wrap(requiresLogin: false, home: '/home/me'));
      await tester.pumpAndSettle();

      expect(find.text('Project'), findsOneWidget);
      expect(find.text('me'), findsOneWidget);
      expect(find.text('/home/me'), findsOneWidget);
      expect(find.text('Start folder'), findsOneWidget);
      expect(find.text('App'), findsNothing);
      expect(find.text('Add a project'), findsNothing);

      await tester.tap(toggle('Choose another folder'));
      await tester.pumpAndSettle();
      expect(find.text('App'), findsOneWidget);
      expect(find.text('Site'), findsOneWidget);
      expect(find.text('Add a project'), findsOneWidget);

      // Picking one makes it the answer and folds the list again.
      await tester.tap(find.text('Site'));
      await tester.pumpAndSettle();
      expect(find.text('Site'), findsOneWidget);
      expect(find.text('/site'), findsOneWidget);
      expect(find.text('App'), findsNothing);
      expect(find.text('Start folder'), findsNothing);

      // The start folder stays one of the choices.
      await tester.tap(toggle('Choose another folder'));
      await tester.pumpAndSettle();
      expect(find.text('Start folder'), findsOneWidget);
      expect(find.text('App'), findsOneWidget);
      expect(toggle('Hide the other folders'), findsOneWidget);
    });

    testWidgets("opened from a project's +, shows that project chosen", (
      tester,
    ) async {
      tallView(tester);
      await tester.pumpWidget(
        _wrap(requiresLogin: false, home: '/home/me', initialCwd: '/site'),
      );
      await tester.pumpAndSettle();

      expect(find.text('Site'), findsOneWidget);
      expect(find.text('/site'), findsOneWidget);
      expect(find.text('App'), findsNothing);
      expect(find.text('Start folder'), findsNothing);
    });

    testWidgets('without a start folder yet, the first project is chosen', (
      tester,
    ) async {
      tallView(tester);
      await tester.pumpWidget(_wrap(requiresLogin: false));
      await tester.pumpAndSettle();

      expect(find.text('App'), findsOneWidget);
      expect(find.text('Site'), findsNothing);
    });
  });

  testWidgets('selecting an agent expands only its capability chips', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap(requiresLogin: false));
    await tester.pumpAndSettle();

    await _selectCodex(tester);
    expect(find.text('Streaming'), findsOneWidget);
    expect(find.text('Approvals'), findsOneWidget);
    expect(find.text('Forking'), findsNothing);

    await tester.tap(find.text('Claude Code'));
    await tester.pumpAndSettle();
    expect(find.text('Streaming'), findsNothing);
    expect(find.text('Approvals'), findsNothing);
    expect(find.text('Plan mode'), findsOneWidget);
    expect(find.text('Forking'), findsOneWidget);
  });

  testWidgets('the picked model reads as a name over its routing id', (
    tester,
  ) async {
    // The field used to show the routing id alone ("gemini-3.7-flash-high"),
    // which says nothing to a reader; the id still has to stay visible, because
    // on multi-provider agents it is what tells two similar names apart.
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _wrap(
        requiresLogin: false,
        models: const [
          AgentModel(
            id: 'gemini-3.7-flash-high',
            displayName: 'Gemini 3.7 Flash (High)',
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();
    await _selectCodex(tester);

    // Nothing picked yet: the hint, and no id anywhere.
    expect(find.text('Default model'), findsOneWidget);
    expect(find.text('gemini-3.7-flash-high'), findsNothing);

    await tester.tap(find.text('Default model'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Gemini 3.7 Flash (High)').last);
    await tester.pumpAndSettle();

    expect(find.text('Gemini 3.7 Flash (High)'), findsOneWidget);
    expect(find.text('gemini-3.7-flash-high'), findsOneWidget);
    expect(find.text('Default model'), findsNothing);
  });

  testWidgets('agent cards remain overflow-free on a compact phone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap(requiresLogin: false));
    await tester.pumpAndSettle();
    await _selectCodex(tester);

    expect(tester.takeException(), isNull);
    expect(find.text('Codex'), findsOneWidget);
    expect(find.text('Images'), findsOneWidget);
  });

  testWidgets('a not-signed-in agent shows the Check sign-in action', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap(requiresLogin: true));
    await tester.pumpAndSettle();
    await _selectCodex(tester);

    expect(find.text('Codex'), findsOneWidget);
    // The warning text is replaced by an actionable re-check button.
    expect(find.widgetWithText(TextButton, 'Check sign-in'), findsOneWidget);
  });

  testWidgets('a signed-in agent shows no Check sign-in action', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap(requiresLogin: false));
    await tester.pumpAndSettle();
    await _selectCodex(tester);

    expect(find.text('Codex'), findsOneWidget);
    expect(find.text('Check sign-in'), findsNothing);
  });

  testWidgets('the Echo dev agent is hidden', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    // Test overrides may advertise the Echo development adapter, but the
    // new-conversation picker keeps it behind `_hiddenAgentIds`.
    await tester.pumpWidget(
      _wrap(
        requiresLogin: false,
        agents: const [
          AgentDescriptor(
            agentId: 'codex',
            displayName: 'Codex',
            available: true,
          ),
          AgentDescriptor(
            agentId: 'echo',
            displayName: 'Echo Agent',
            available: true,
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Codex'), findsOneWidget);
    expect(find.text('Echo Agent'), findsNothing);
  });

  group('the container follows the window, the content does not', () {
    // M3's full-screen dialog is a COMPACT-window pattern. Past `expanded` the
    // same form becomes a dialog over whatever is there: spreading three
    // answers across 1600 px makes the eye cross the whole monitor between the
    // agent list and Start, and covers the drawer it was launched from.
    Future<void> open(WidgetTester tester, {required double width}) async {
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            connectedDeviceProvider.overrideWith((ref) => Stream.value(_pc)),
            projectsProvider.overrideWith(
              (ref, deviceId) => Stream.value(
                const [Project(id: 'p1', name: 'App', cwd: '/app')],
              ),
            ),
            bridgeHomeProvider.overrideWith((ref) => Stream.value(null)),
            agentsProvider.overrideWith(
              (ref) async => const <AgentDescriptor>[],
            ),
            agentModelsProvider
                .overrideWith((ref, id) async => const <AgentModel>[]),
            authStatusProvider.overrideWith(
              (ref, agentId) async => AuthStatus(
                agentId: agentId,
                requiresLogin: false,
                loginInProgress: false,
              ),
            ),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: ElevatedButton(
                    onPressed: () => NewConversationScreen.show(context),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
    }

    testWidgets('a phone gets the full-screen dialog', (tester) async {
      await open(tester, width: 390);

      expect(find.byType(Dialog), findsNothing);
      expect(
        tester.getSize(find.byType(NewConversationScreen)).width,
        390,
        reason: 'a phone has no room to bound anything',
      );
    });

    testWidgets('a wide window bounds it instead', (tester) async {
      await open(tester, width: 1280);

      expect(find.byType(Dialog), findsOneWidget);
      expect(
        tester.getSize(find.byType(NewConversationScreen)).width,
        lessThanOrEqualTo(560),
        reason: 'the form stretched across the whole window',
      );
    });
  });

  group('a folder with a lot of history stays a short form', () {
    // The screen is for starting: at most the three newest conversations and
    // one quiet row that counts the agents' own sessions here — the lists
    // themselves live in the catalog (architecture/02a §5.8.19, §5.8.21).
    final threads = [
      for (var i = 0; i < 30; i++)
        Thread(
          id: 't$i',
          title: 'Conversation $i',
          agentId: 'codex',
          syncState: ThreadSyncState.synced,
          status: ThreadStatus.active,
          projectId: 'p1',
          deviceId: 'mac-1',
          cwd: '/app',
          lastActivity: DateTime(2026, 10, 30).subtract(Duration(hours: i)),
        ),
    ];
    final sessions = AgentSessionList(
      sessions: [
        for (var i = 0; i < 15; i++)
          AgentSessionSummary(
            agentId: 'claude-code',
            sessionId: 's-$i',
            cwd: '/app',
            updatedAgo: Duration(hours: i + 1),
            title: i.isEven ? 'Native session $i' : null,
          ),
      ],
      unlisted: const ['antigravity-cli'],
    );

    testWidgets('shows three recent conversations and one sessions link', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(900, 3200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _wrap(
          requiresLogin: false,
          initialCwd: '/app',
          threads: threads,
          sessions: sessions,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(CatalogRow), findsNWidgets(3));
      expect(find.text('See all conversations (30)'), findsOneWidget);
      expect(
        find.text('15 agent sessions in this folder outside Uxnan'),
        findsOneWidget,
      );
      // None of the sessions is listed here, nor expandable in place.
      expect(find.text('Native session 0'), findsNothing);
      expect(find.text('Untitled session'), findsNothing);
      expect(find.textContaining('Show all'), findsNothing);
      expect(find.textContaining("can't list its sessions"), findsNothing);
    });

    testWidgets('counts sessions, named or not, and not their titles', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(900, 3200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _wrap(
          requiresLogin: false,
          initialCwd: '/app',
          sessions: const AgentSessionList(
            sessions: [
              AgentSessionSummary(
                agentId: 'opencode',
                sessionId: 'o-1',
                cwd: '/app',
                updatedAgo: Duration(hours: 1),
                titlePending: true,
              ),
              AgentSessionSummary(
                agentId: 'opencode',
                sessionId: 'o-2',
                cwd: '/app',
                updatedAgo: Duration(hours: 2),
                titlePending: true,
              ),
              AgentSessionSummary(
                agentId: 'codex',
                sessionId: 'c-1',
                cwd: '/app',
                updatedAgo: Duration(hours: 3),
                title: 'Named already',
              ),
            ],
            unlisted: [],
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('3 agent sessions in this folder outside Uxnan'),
        findsOneWidget,
      );
    });

    testWidgets('has no sessions row when the folder has none', (tester) async {
      tester.view.physicalSize = const Size(900, 3200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _wrap(
          requiresLogin: false,
          initialCwd: '/app',
          threads: threads,
          sessions: const AgentSessionList(sessions: [], unlisted: []),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('agent session'), findsNothing);
      expect(find.byType(CatalogRow), findsNWidgets(3));
    });

    testWidgets('an empty folder is just the form', (tester) async {
      tester.view.physicalSize = const Size(900, 3200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _wrap(
          requiresLogin: false,
          initialCwd: '/app',
          sessions: const AgentSessionList(sessions: [], unlisted: []),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(CatalogRow), findsNothing);
      expect(find.textContaining('See all conversations'), findsNothing);
      expect(find.textContaining('agent session'), findsNothing);
    });

    testWidgets('the sessions row opens the catalog on its sessions view', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(900, 3200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _wrap(
          requiresLogin: false,
          initialCwd: '/app',
          threads: threads,
          sessions: sessions,
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.text('15 agent sessions in this folder outside Uxnan'),
      );
      await tester.pumpAndSettle();

      expect(find.byType(ConversationCatalogScreen), findsOneWidget);
      expect(find.text('Search agent sessions by title'), findsOneWidget);
      expect(find.text('Native session 0'), findsOneWidget);
      expect(
        find.text(
          "Antigravity can't list its sessions: continue one "
          'from the terminal it runs in.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('holds the slot while the PC answers', (tester) async {
      tester.view.physicalSize = const Size(900, 3200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final answer = Completer<AgentSessionList>();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            ..._baseOverrides(threads: threads),
            agentSessionsProvider
                .overrideWith((ref, cwd) => Stream.fromFuture(answer.future)),
            agentSessionHoldsProvider
                .overrideWith((ref) => Stream.value(const {})),
          ],
          child: _app(const NewConversationScreen(initialCwd: '/app')),
        ),
      );
      await tester.pump(const Duration(milliseconds: 50));
      final before = tester.getTopLeft(find.text('See all conversations (30)'));

      answer.complete(sessions);
      await tester.pumpAndSettle();

      // What is above the slot did not move when it filled in.
      expect(
        tester.getTopLeft(find.text('See all conversations (30)')),
        before,
      );
      expect(
        find.text('15 agent sessions in this folder outside Uxnan'),
        findsOneWidget,
      );
    });
  });
}

/// The PC a new conversation starts on — its projects are the ones offered.
final TrustedDevice _pc = TrustedDevice(
  macDeviceId: 'mac-1',
  displayName: 'PC',
  macIdentityPublicKey: Uint8List(32),
  sessionId: 'session-1',
  pairedAt: DateTime(2026),
);
