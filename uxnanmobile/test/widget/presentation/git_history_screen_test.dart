import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/git_action_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/value_objects/git/git_log.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_history_screen.dart';

/// Sample commit list used by the tests below.
List<GitCommit> _sampleCommits() => [
      const GitCommit(
        sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        shortSha: 'a1b2c3d',
        parents: [
          '0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f',
        ],
        authorName: 'Luis',
        authorEmail: 'luis@example.com',
        authorTimestamp: 1735689600,
        committerName: 'Luis',
        committerEmail: 'luis@example.com',
        committerTimestamp: 1735689600,
        messageTitle: 'feat: history view',
        messageBody: 'adds the new screen',
      ),
      const GitCommit(
        sha: '0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f',
        shortSha: '0f0f0f0',
        parents: [],
        authorName: 'Luis',
        authorEmail: 'luis@example.com',
        authorTimestamp: 1735603200,
        committerName: 'Luis',
        committerEmail: 'luis@example.com',
        committerTimestamp: 1735603200,
        messageTitle: 'chore: initial commit',
        messageBody: '',
      ),
    ];

/// Build a [GitActionManager] whose `log()` returns the supplied commits
/// and whose other RPCs are no-ops.
GitActionManager _stubManager({
  required List<GitCommit> commits,
  bool hasMore = false,
  String? nextCursor,
  Exception? error,
  List<GitCommit>? moreCommits,
}) {
  return GitActionManager(
    domainEvents: const Stream<DomainEvent>.empty(),
    sendRequest: (method, [params]) async {
      if (method != 'git/log') {
        return RpcMessage.response(id: '1', result: const {});
      }
      if (error != null) throw error;
      final paramsMap = params is Map ? params : null;
      final cursor = paramsMap == null ? null : paramsMap['cursor'] as String?;
      if (cursor != null && moreCommits != null) {
        return RpcMessage.response(
          id: '1',
          result: {
            'commits': moreCommits
                .map(_commitToJson)
                .toList(),
            'hasMore': false,
          },
        );
      }
      return RpcMessage.response(
        id: '1',
        result: {
          'commits': commits.map(_commitToJson).toList(),
          'hasMore': hasMore,
          if (nextCursor != null) 'nextCursor': nextCursor,
        },
      );
    },
  );
}

Map<String, dynamic> _commitToJson(GitCommit c) => {
      'sha': c.sha,
      'shortSha': c.shortSha,
      'parents': c.parents,
      'authorName': c.authorName,
      'authorEmail': c.authorEmail,
      'authorTimestamp': c.authorTimestamp,
      'committerName': c.committerName,
      'committerEmail': c.committerEmail,
      'committerTimestamp': c.committerTimestamp,
      'messageTitle': c.messageTitle,
      'messageBody': c.messageBody,
    };

/// Wraps [child] in a [ProviderScope] that overrides the git providers with
/// the supplied stubs.
Widget _wrap({
  required Widget child,
  required GitActionManager manager,
}) {
  return ProviderScope(
    overrides: [
      gitActionManagerProvider.overrideWith((ref) => manager),
      gitRepoStateProvider.overrideWith(
        (ref) => Stream.value(const GitRepoState(branch: 'main')),
      ),
      gitActiveActionProvider.overrideWith((ref) => Stream.value(null)),
    ],
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    ),
  );
}

void main() {
  testWidgets('renders the commits in list view', (tester) async {
    final manager = _stubManager(commits: _sampleCommits());
    addTearDown(manager.dispose);

    await tester.pumpWidget(
      _wrap(
        manager: manager,
        child: const GitHistoryScreen(cwd: '/repo'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('History'), findsOneWidget);
    expect(find.text('feat: history view'), findsOneWidget);
    expect(find.text('chore: initial commit'), findsOneWidget);
    expect(find.textContaining('Luis'), findsAtLeastNWidgets(2));
  });

  testWidgets('renders the empty state when there are no commits',
      (tester) async {
    final manager = _stubManager(commits: const []);
    addTearDown(manager.dispose);

    await tester.pumpWidget(
      _wrap(
        manager: manager,
        child: const GitHistoryScreen(cwd: '/repo'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No commits yet'), findsOneWidget);
  });

  testWidgets('shows the error state with retry when the RPC fails',
      (tester) async {
    final manager = _stubManager(
      commits: const [],
      error: Exception('boom'),
    );
    addTearDown(manager.dispose);

    await tester.pumpWidget(
      _wrap(
        manager: manager,
        child: const GitHistoryScreen(cwd: '/repo'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text("Couldn't load commit history"), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('toggles between list and graph views', (tester) async {
    final manager = _stubManager(commits: _sampleCommits());
    addTearDown(manager.dispose);

    await tester.pumpWidget(
      _wrap(
        manager: manager,
        child: const GitHistoryScreen(cwd: '/repo'),
      ),
    );
    await tester.pumpAndSettle();

    // Default view is list (the toggle button shows the "graph" icon).
    expect(find.byIcon(Icons.account_tree_rounded), findsOneWidget);

    await tester.tap(find.byIcon(Icons.account_tree_rounded));
    await tester.pumpAndSettle();

    // After tap, the toggle now shows the "list" icon.
    expect(find.byIcon(Icons.view_list_rounded), findsOneWidget);
    // The graph rows render CustomPaint widgets for each commit.
    expect(find.byType(CustomPaint), findsAtLeastNWidgets(2));
  });

  testWidgets('opens the details bottom sheet when a row is tapped',
      (tester) async {
    final manager = _stubManager(commits: _sampleCommits());
    addTearDown(manager.dispose);

    await tester.pumpWidget(
      _wrap(
        manager: manager,
        child: const GitHistoryScreen(cwd: '/repo'),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('feat: history view'));
    await tester.pumpAndSettle();

    expect(find.text('Commit details'), findsOneWidget);
    expect(find.text('Full message'), findsOneWidget);
    expect(find.text('adds the new screen'), findsOneWidget);
    expect(find.byTooltip('Copy SHA'), findsOneWidget);
    expect(find.text('Copy message'), findsOneWidget);
  });
}
