import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';

/// A canned `workspace/list` for the repo root (browse mode, empty `@` query).
const _rootListing = <String, dynamic>{
  'cwd': '.',
  'entries': [
    {'name': 'lib', 'type': 'dir'},
    {'name': 'README.md', 'type': 'file', 'size': 1024},
  ],
};

/// A canned `workspace/searchFiles` result (fuzzy mode, typed `@` query).
const _searchResult = <String, dynamic>{
  'cwd': '.',
  'truncated': false,
  'matches': [
    {'path': 'lib/main.dart', 'type': 'file'},
  ],
};

/// A [FileBrowserManager] that answers `workspace/list` with [_rootListing] and
/// `workspace/searchFiles` with [_searchResult].
FileBrowserManager _stubManager() => FileBrowserManager(
      sendRequest: (method, [params]) async => RpcMessage.response(
        id: '1',
        result:
            method == 'workspace/searchFiles' ? _searchResult : _rootListing,
      ),
    );

/// A [FileBrowserManager] emulating an **older bridge**: `workspace/searchFiles`
/// is rejected as an unknown method (-32601); `workspace/list` still works.
FileBrowserManager _oldBridgeManager() => FileBrowserManager(
      sendRequest: (method, [params]) async => method == 'workspace/searchFiles'
          ? RpcMessage.response(
              id: '1',
              error: const RpcError(code: -32601, message: 'Method not found'),
            )
          : RpcMessage.response(id: '1', result: _rootListing),
    );

Widget _wrap({
  required Widget child,
  FileBrowserManager? manager,
}) {
  return ProviderScope(
    overrides: [
      if (manager != null)
        fileBrowserManagerProvider.overrideWith((ref) => manager),
    ],
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Align(
          alignment: Alignment.bottomCenter,
          child: ComposerBar(onSend: (_) {}, cwd: '/repo'),
        ),
      ),
    ),
  );
}

String _composerText(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!.text;

void main() {
  testWidgets('typing / opens the command palette and inserts a template',
      (tester) async {
    await tester.pumpWidget(_wrap(child: const SizedBox()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '/rev');
    await tester.pumpAndSettle();

    // The palette surfaces the matching command.
    expect(find.text('Commands'), findsOneWidget);
    expect(find.text('Review'), findsOneWidget);

    await tester.tap(find.text('Review'));
    await tester.pumpAndSettle();

    // The /command was replaced by its prompt template.
    expect(_composerText(tester), 'Review this for bugs and improvements: ');
  });

  testWidgets('typing @ lists the workspace and inserts the picked file',
      (tester) async {
    final manager = _stubManager();
    addTearDown(manager.dispose);

    await tester.pumpWidget(_wrap(child: const SizedBox(), manager: manager));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '@');
    await tester.pumpAndSettle();

    // The file panel lists the directory entries (folder shown with a slash).
    expect(find.text('Files & folders'), findsOneWidget);
    expect(find.text('lib/'), findsOneWidget);
    expect(find.text('README.md'), findsOneWidget);

    await tester.tap(find.text('README.md'));
    await tester.pumpAndSettle();

    // A file finalizes the mention: @path + trailing space.
    expect(_composerText(tester), '@README.md ');
  });

  testWidgets('picking a folder drills in and keeps the picker open',
      (tester) async {
    final manager = _stubManager();
    addTearDown(manager.dispose);

    await tester.pumpWidget(_wrap(child: const SizedBox(), manager: manager));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '@');
    await tester.pumpAndSettle();

    await tester.tap(find.text('lib/'));
    await tester.pumpAndSettle();

    // The folder drilled in (trailing slash, no space) and the panel stays up.
    expect(_composerText(tester), '@lib/');
    expect(find.text('Files & folders'), findsOneWidget);
  });

  testWidgets('typing a query fuzzy-searches the repo and inserts the match',
      (tester) async {
    final manager = _stubManager();
    addTearDown(manager.dispose);

    await tester.pumpWidget(_wrap(child: const SizedBox(), manager: manager));
    await tester.pumpAndSettle();

    // A non-empty basename fragment switches to repo-wide fuzzy search; the
    // result shows the full repo-relative path (not just the basename).
    await tester.enterText(find.byType(TextField), '@main');
    await tester.pumpAndSettle();
    expect(find.textContaining('main.dart'), findsOneWidget);

    await tester.tap(find.textContaining('main.dart'));
    await tester.pumpAndSettle();

    // The picked match is inserted as a finalized mention (path + space).
    expect(_composerText(tester), '@lib/main.dart ');
  });

  testWidgets('falls back to browsing + filtering when the bridge lacks search',
      (tester) async {
    final manager = _oldBridgeManager();
    addTearDown(manager.dispose);

    await tester.pumpWidget(_wrap(child: const SizedBox(), manager: manager));
    await tester.pumpAndSettle();

    // `workspace/searchFiles` is rejected (older bridge) → the picker degrades
    // to browsing the current folder and filtering it locally, so `@README`
    // still surfaces the matching file.
    await tester.enterText(find.byType(TextField), '@README');
    await tester.pumpAndSettle();

    expect(find.text('README.md'), findsOneWidget);

    await tester.tap(find.text('README.md'));
    await tester.pumpAndSettle();
    expect(_composerText(tester), '@README.md ');
  });
}
