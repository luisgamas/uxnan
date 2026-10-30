import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/prompt_template.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_bar.dart';

/// Fixed `/` palette templates so the command test doesn't depend on disk/seed.
const _templates = [
  PromptTemplate(
    id: 'review',
    label: 'Review',
    body: 'Review this for bugs and improvements: ',
  ),
];

/// A [PromptTemplatesLibrary] that skips disk hydration and serves [_items].
class _FixedTemplatesLibrary extends PromptTemplatesLibrary {
  _FixedTemplatesLibrary(this._items);
  final List<PromptTemplate> _items;
  @override
  List<PromptTemplate> build() => _items;
}

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
  List<AttachmentContent> picked = const [],
  void Function(String text, List<AttachmentContent> attachments)? onSend,
}) {
  return ProviderScope(
    overrides: [
      if (manager != null)
        fileBrowserManagerProvider.overrideWith((ref) => manager),
      promptTemplatesLibraryProvider
          .overrideWith(() => _FixedTemplatesLibrary(_templates)),
    ],
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Align(
          alignment: Alignment.bottomCenter,
          child: ComposerBar(
            onSend: onSend ?? (_, __) {},
            cwd: '/repo',
            onAttach: (source, {required images, required files}) async =>
                picked,
          ),
        ),
      ),
    ),
  );
}

String _composerText(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!.text;

/// A 1×1 transparent PNG, so `Image.memory` decodes a real image in tests.
const _pngPixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ'
    'DwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

ImageContent _image([String? name]) =>
    ImageContent(mimeType: 'image/png', name: name, base64Data: _pngPixel);

TextEditingController _controller(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!;

/// Picks from the "+" menu's photo library (what [_wrap]'s `picked` holds).
Future<void> _attachFromGallery(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('turn-tools-menu')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Photo library'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('typing / opens the command palette and inserts a template',
      (tester) async {
    await tester.pumpWidget(_wrap(child: const SizedBox()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '/rev');
    await tester.pumpAndSettle();

    // The palette surfaces the matching command.
    expect(find.byKey(const ValueKey('command-palette')), findsOneWidget);
    expect(find.text('/'), findsOneWidget);
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
    expect(find.byKey(const ValueKey('suggestion-header-@')), findsOneWidget);
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

  testWidgets('picked images become chips at the caret, inside the text',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        child: const SizedBox(),
        picked: [_image('a.png'), _image('b.png')],
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'in this image you see X');
    // The caret after "image".
    _controller(tester).selection = const TextSelection.collapsed(offset: 13);
    await _attachFromGallery(tester);

    expect(
      _composerText(tester),
      'in this image \uFFFC \uFFFC you see X',
    );
    // Chips drawn inside the field itself, in order.
    final field = find.byType(TextField);
    final first = find.byKey(const ValueKey('composer-chip-0'));
    final second = find.byKey(const ValueKey('composer-chip-1'));
    expect(find.descendant(of: field, matching: first), findsOneWidget);
    expect(find.descendant(of: field, matching: second), findsOneWidget);
    expect(find.text('a.png'), findsOneWidget);
    expect(find.text('b.png'), findsOneWidget);
    expect(
      tester.getRect(first).left,
      lessThan(tester.getRect(second).left),
    );
    // The caret lands after what was inserted, ready to keep writing.
    expect(_controller(tester).selection.baseOffset, 17);
  });

  testWidgets('send passes the text with its markers and the chips in order',
      (tester) async {
    String? sentText;
    List<AttachmentContent>? sentAttachments;
    await tester.pumpWidget(
      _wrap(
        child: const SizedBox(),
        picked: [_image('a.png')],
        onSend: (text, attachments) {
          sentText = text;
          sentAttachments = attachments;
        },
      ),
    );
    await tester.pumpAndSettle();

    await _attachFromGallery(tester);
    // An attachment alone enables Send (attachment-only message).
    expect(find.byKey(const ValueKey('send')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('send')));
    await tester.pumpAndSettle();

    expect(sentText, '\uFFFC');
    expect(sentAttachments, [_image('a.png')]);
    expect(_composerText(tester), isEmpty);
  });

  testWidgets('tapping a chip opens its preview; Remove takes it out',
      (tester) async {
    await tester.pumpWidget(
      _wrap(child: const SizedBox(), picked: [_image('a.png')]),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'see');
    await _attachFromGallery(tester);
    expect(_composerText(tester), 'see \uFFFC ');

    await tester.tap(find.byKey(const ValueKey('composer-chip-0')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('attachment-sheet-image')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('attachment-sheet-remove')));
    await tester.pumpAndSettle();

    expect(_composerText(tester), 'see ');
    expect(find.byKey(const ValueKey('composer-chip-0')), findsNothing);
  });

  testWidgets('the composer keeps its stadium shape until it holds a chip',
      (tester) async {
    await tester.pumpWidget(
      _wrap(child: const SizedBox(), picked: [_image('a.png')]),
    );
    await tester.pumpAndSettle();

    RoundedRectangleBorder shapeOf(WidgetTester tester) => tester
        .widget<Material>(find.byKey(const ValueKey('composer-surface')))
        .shape! as RoundedRectangleBorder;

    expect(shapeOf(tester).borderRadius, BorderRadius.circular(999));

    // With a chip it morphs into a rounded surface so a chip at a line's
    // end isn't clipped by the pill's round ends.
    await _attachFromGallery(tester);
    expect(shapeOf(tester).borderRadius, BorderRadius.circular(24));
  });
}
