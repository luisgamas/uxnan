import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/coordinators/session_coordinator.dart';
import 'package:uxnan/application/managers/bridge_replica.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';
import 'package:uxnan/domain/value_objects/conversation_transfer.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/threads/agent_sessions_view.dart';
import 'package:uxnan/presentation/screens/threads/conversation_catalog_screen.dart';

// The catalog's second view: the agents' own sessions in a folder, outside
// Uxnan, to pick up as a conversation (architecture/02a §5.8.19). The one
// place the app lists them.

class _Manager extends Fake implements ThreadManager {
  final started = <Map<String, String?>>[];

  @override
  Future<Thread> startThread({
    String? projectId,
    String? title,
    String? agentId,
    String? model,
    String? cwd,
    String? deviceId,
    String? worktreePath,
    String? agentSessionId,
    String? continueFromThreadId,
    TransferStrategy continueStrategy = TransferStrategy.selection,
  }) async {
    started.add({
      'agentId': agentId,
      'agentSessionId': agentSessionId,
      'title': title,
      'cwd': cwd,
    });
    return Thread(
      id: 'new-thread',
      title: title ?? '',
      agentId: agentId ?? '',
      syncState: ThreadSyncState.synced,
      status: ThreadStatus.active,
    );
  }
}

class _Coordinator extends Fake implements SessionCoordinator {
  @override
  TrustedDevice? get connectedDevice => null;
}

class _Replica extends Fake implements BridgeReplica {
  _Replica(this.outcome);

  final AgentSessionHandoffOutcome outcome;
  final asked = <String>[];

  @override
  Future<AgentSessionHandoffOutcome> requestHandoff({
    required String agentId,
    required String sessionId,
  }) async {
    asked.add('$agentId:$sessionId');
    return outcome;
  }
}

const _held = AgentSessionHold(
  agentId: 'codex',
  sessionId: 'c-1',
  holderName: 'Studio',
  busy: true,
);

const _sessions = AgentSessionList(
  sessions: [
    AgentSessionSummary(
      agentId: 'claude-code',
      sessionId: 's-1',
      cwd: '/app',
      updatedAgo: Duration(minutes: 5),
      title: 'Payment flow refactor',
    ),
    AgentSessionSummary(
      agentId: 'codex',
      sessionId: 'c-1',
      cwd: '/app',
      updatedAgo: Duration(hours: 1),
      title: 'Release notes draft',
      hold: _held,
    ),
    AgentSessionSummary(
      agentId: 'codex',
      sessionId: 'c-2',
      cwd: '/app',
      updatedAgo: Duration(days: 2),
    ),
    AgentSessionSummary(
      agentId: 'opencode',
      sessionId: 'o-1',
      cwd: '/app',
      updatedAgo: Duration(days: 3),
      titlePending: true,
    ),
  ],
  unlisted: ['antigravity-cli'],
);

final _pc = TrustedDevice(
  macDeviceId: 'mac-1',
  displayName: 'PC',
  macIdentityPublicKey: Uint8List(32),
  sessionId: 'session-1',
  pairedAt: DateTime(2026),
);

List<Override> _overrides({
  _Manager? manager,
  _Replica? replica,
  Map<String, AgentSessionHold> holds = const {},
}) =>
    [
      threadsProvider.overrideWith((ref) => Stream.value(const <Thread>[])),
      projectsProvider.overrideWith(
        (ref, id) => Stream.value(
          const [Project(id: 'p1', name: 'App', cwd: '/app')],
        ),
      ),
      agentsProvider.overrideWith(
        (ref) async => const [
          AgentDescriptor(
            agentId: 'claude-code',
            displayName: 'Claude Code',
            available: true,
          ),
          AgentDescriptor(
            agentId: 'codex',
            displayName: 'Codex',
            available: true,
          ),
        ],
      ),
      connectedDeviceProvider.overrideWith((ref) => Stream.value(_pc)),
      agentSessionsProvider.overrideWith((ref, cwd) => Stream.value(_sessions)),
      agentSessionHoldsProvider.overrideWith((ref) => Stream.value(holds)),
      if (manager != null) threadManagerProvider.overrideWithValue(manager),
      if (replica != null) bridgeReplicaProvider.overrideWithValue(replica),
      sessionCoordinatorProvider.overrideWithValue(_Coordinator()),
    ];

Future<void> _open(
  WidgetTester tester, {
  String? sessionsCwd = '/app',
  CatalogView view = CatalogView.sessions,
  _Manager? manager,
  _Replica? replica,
  Map<String, AgentSessionHold> holds = const {},
  void Function(String id)? onOpen,
}) async {
  tester.view.physicalSize = const Size(600, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: _overrides(manager: manager, replica: replica, holds: holds),
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: ConversationCatalogScreen(
          deviceId: 'mac-1',
          projectId: 'p1',
          sessionsCwd: sessionsCwd,
          initialView: view,
          onOpen: onOpen ?? (_) {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('filterAgentSessions', () {
    test('keeps every session without a filter', () {
      expect(filterAgentSessions(_sessions.sessions), _sessions.sessions);
    });

    test('narrows by agent', () {
      final only = filterAgentSessions(_sessions.sessions, agentId: 'codex');
      expect(only.map((s) => s.sessionId), ['c-1', 'c-2']);
    });

    test('matches every word of the query against the title, in any case', () {
      final found = filterAgentSessions(_sessions.sessions, query: 'FLOW pay');
      expect(found.map((s) => s.sessionId), ['s-1']);
    });

    test('a query leaves out a session with no title', () {
      final found = filterAgentSessions(_sessions.sessions, query: 'a');
      expect(found.map((s) => s.sessionId), isNot(contains('c-2')));
    });
  });

  testWidgets('lists the sessions of the folder, with what holds them', (
    tester,
  ) async {
    await _open(tester);

    expect(find.text('Payment flow refactor'), findsOneWidget);
    expect(find.text('Release notes draft'), findsOneWidget);
    // Untitled and left alone, or untitled and being named by the bridge.
    expect(find.text('Untitled session'), findsOneWidget);
    expect(find.text('Naming…'), findsOneWidget);
    expect(find.text('Working in a terminal on Studio'), findsOneWidget);
    expect(find.textContaining("can't list its sessions"), findsOneWidget);
    expect(find.text('Search agent sessions by title'), findsOneWidget);
  });

  testWidgets('the search field narrows them by title', (tester) async {
    await _open(tester);

    await tester.enterText(find.byType(SearchBar), 'release');
    await tester.pumpAndSettle();

    expect(find.text('Release notes draft'), findsOneWidget);
    expect(find.text('Payment flow refactor'), findsNothing);

    await tester.enterText(find.byType(SearchBar), 'zzz');
    await tester.pumpAndSettle();
    expect(find.text('Nothing matches'), findsOneWidget);
  });

  testWidgets('switches back to the conversations', (tester) async {
    await _open(tester);

    await tester.tap(find.text('Conversations').first);
    await tester.pumpAndSettle();

    expect(find.text('Payment flow refactor'), findsNothing);
    expect(find.text('Search titles and what was said'), findsOneWidget);
  });

  testWidgets('has no view switch without a folder to list sessions of', (
    tester,
  ) async {
    await _open(tester, sessionsCwd: null);

    expect(find.text('Agent sessions'), findsNothing);
    expect(find.text('Search titles and what was said'), findsOneWidget);
  });

  testWidgets('picking a free session starts a conversation on it', (
    tester,
  ) async {
    final manager = _Manager();
    String? opened;
    await _open(
      tester,
      manager: manager,
      onOpen: (id) => opened = id,
    );

    await tester.tap(find.text('Payment flow refactor'));
    await tester.pumpAndSettle();

    expect(manager.started, [
      {
        'agentId': 'claude-code',
        'agentSessionId': 's-1',
        'title': 'Payment flow refactor',
        'cwd': '/app',
      },
    ]);
    expect(opened, 'new-thread');
  });

  testWidgets('a session a terminal holds is asked for first', (tester) async {
    final manager = _Manager();
    final replica = _Replica(AgentSessionHandoffOutcome.released);
    String? opened;
    await _open(
      tester,
      manager: manager,
      replica: replica,
      holds: {_held.key: _held},
      onOpen: (id) => opened = id,
    );

    await tester.tap(find.text('Release notes draft'));
    await tester.pumpAndSettle();

    expect(replica.asked, ['codex:c-1']);
    expect(manager.started.single['agentSessionId'], 'c-1');
    expect(opened, 'new-thread');
  });

  testWidgets('a terminal that keeps its session starts nothing', (
    tester,
  ) async {
    final manager = _Manager();
    final replica = _Replica(AgentSessionHandoffOutcome.declined);
    String? opened;
    await _open(
      tester,
      manager: manager,
      replica: replica,
      holds: {_held.key: _held},
      onOpen: (id) => opened = id,
    );

    await tester.tap(find.text('Release notes draft'));
    await tester.pumpAndSettle();

    expect(manager.started, isEmpty);
    expect(opened, isNull);
    expect(find.text('The terminal kept the session.'), findsOneWidget);
  });
}
