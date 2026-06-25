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
      if (method == 'git/branches') {
        return RpcMessage.response(
          id: '1',
          result: const {
            'current': 'main',
            'local': ['main', 'feature/x'],
            'remote': ['origin/main'],
          },
        );
      }
      if (method == 'git/commitShow') {
        final paramsMap = params is Map ? params : null;
        final sha = paramsMap?['sha'] as String? ?? '';
        return RpcMessage.response(
          id: '1',
          result: {
            'commit': _commitToJson(
              commits.firstWhere(
                (c) => c.sha == sha,
                orElse: () => commits.first,
              ),
            ),
            'files': const [
              {
                'path': 'lib/main.dart',
                'status': 'modified',
                'additions': 3,
                'deletions': 1,
              },
            ],
            'diff': 'diff --git a/lib/main.dart b/lib/main.dart\n'
                'index 1111111..2222222 100644\n'
                '--- a/lib/main.dart\n'
                '+++ b/lib/main.dart\n'
                '@@ -1,1 +1,2 @@\n'
                ' context\n'
                '+new line\n',
          },
        );
      }
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
            'commits': moreCommits.map(_commitToJson).toList(),
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
      if (c.refs.isNotEmpty)
        'refs': [
          for (final r in c.refs) {'name': r.name, 'type': r.type.name},
        ],
    };

/// A commit decorated with several refs (HEAD + branch + remote) — used to
/// check the graph row doesn't overflow on a narrow screen.
List<GitCommit> _decoratedCommits() => [
      const GitCommit(
        sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        shortSha: 'a1b2c3d',
        parents: ['0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f'],
        authorName: 'Luis',
        authorEmail: 'luis@example.com',
        authorTimestamp: 1735689600,
        committerName: 'Luis',
        committerEmail: 'luis@example.com',
        committerTimestamp: 1735689600,
        messageTitle: 'feat: a commit with a long title that should ellipsize',
        messageBody: '',
        refs: [
          GitRef(name: 'HEAD', type: GitRefType.head),
          GitRef(name: 'main', type: GitRefType.branch),
          GitRef(name: 'origin/main', type: GitRefType.remoteBranch),
        ],
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

  testWidgets('toggles the graph overlay on and off', (tester) async {
    final manager = _stubManager(commits: _sampleCommits());
    addTearDown(manager.dispose);

    await tester.pumpWidget(
      _wrap(
        manager: manager,
        child: const GitHistoryScreen(cwd: '/repo'),
      ),
    );
    await tester.pumpAndSettle();

    // Graph is off by default → the toggle shows the outlined tree icon.
    expect(find.byIcon(Icons.account_tree_outlined), findsOneWidget);

    await tester.tap(find.byIcon(Icons.account_tree_outlined));
    await tester.pumpAndSettle();

    // Graph is on → the toggle shows the filled tree icon and the commits
    // still render (now with the lane gutter).
    expect(find.byIcon(Icons.account_tree_rounded), findsOneWidget);
    expect(find.text('feat: history view'), findsOneWidget);
  });

  testWidgets('graph rows with several refs do not overflow when narrow',
      (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final manager = _stubManager(commits: _decoratedCommits());
    addTearDown(manager.dispose);

    await tester.pumpWidget(
      _wrap(
        manager: manager,
        child: const GitHistoryScreen(cwd: '/repo'),
      ),
    );
    await tester.pumpAndSettle();

    // Enable the graph overlay (gutter + ref chips compete for width here).
    await tester.tap(find.byIcon(Icons.account_tree_outlined));
    await tester.pumpAndSettle();

    // No RenderFlex overflow was thrown during layout/paint.
    expect(tester.takeException(), isNull);
    // The primary ref ("main") chip renders, with a "+2" overflow marker.
    expect(find.text('main'), findsOneWidget);
    expect(find.text('+2'), findsOneWidget);
  });

  testWidgets('toggles compact density', (tester) async {
    final manager = _stubManager(commits: _sampleCommits());
    addTearDown(manager.dispose);

    await tester.pumpWidget(
      _wrap(
        manager: manager,
        child: const GitHistoryScreen(cwd: '/repo'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.density_small_rounded), findsOneWidget);
    await tester.tap(find.byIcon(Icons.density_small_rounded));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.density_medium_rounded), findsOneWidget);
  });

  testWidgets('opens the branch picker and switches the viewed ref',
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

    await tester.tap(find.byIcon(Icons.alt_route_rounded));
    await tester.pumpAndSettle();

    // The picker lists HEAD + the branches.
    expect(find.text('View history of…'), findsOneWidget);
    expect(find.text('Current branch (HEAD)'), findsOneWidget);
    expect(find.text('feature/x'), findsOneWidget);

    await tester.tap(find.text('feature/x'));
    await tester.pumpAndSettle();

    // The "viewing <ref>" banner appears for the non-default ref.
    expect(find.textContaining('feature/x'), findsWidgets);
  });

  testWidgets('opens the full commit detail screen when a row is tapped',
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

    // Pushed the dedicated detail screen (not a bottom sheet).
    expect(find.text('Commit details'), findsOneWidget);
    expect(find.byTooltip('Copy SHA'), findsOneWidget);
    expect(find.text('Copy message'), findsOneWidget);
    // The file card from git/commitShow renders (basename as the card title);
    // its diff is collapsed by default…
    expect(find.text('main.dart'), findsOneWidget);
    expect(find.textContaining('new line'), findsNothing);

    // …and reveals that file's own diff when the card is expanded.
    await tester.tap(find.text('main.dart'));
    await tester.pumpAndSettle();
    expect(find.textContaining('new line'), findsOneWidget);
  });
}
