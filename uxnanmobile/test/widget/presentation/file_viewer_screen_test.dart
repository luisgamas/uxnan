import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_viewer_screen.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';

/// A repository of common markdown strings used by the viewer's preview
/// tests. The original regression was triggered by an empty-ish file
/// (CLAUDE.md → "AGENTS.md"), so we keep that case alongside typical
/// README content with headings, lists and code blocks.
const _markdownSamples = <String>[
  'AGENTS.md',
  '''
# Uxnan

A multi-component monorepo.

## Conventions

- Follow Clean Architecture.
- Run `dart analyze` before commit.
- Update CHANGELOG entries.

## Sections

1. Mobile
2. Desktop
3. Bridge
4. Relay
5. Shared
''',
  '''
```dart
void main() => runApp(const MyApp());
```

A long paragraph that should wrap correctly within the body width and never overflow horizontally even on narrow screens.

- Item 1
- Item 2
- Item 3
''',
];

Widget _wrap({
  required Widget child,
  required FileBrowserManager manager,
  Brightness brightness = Brightness.dark,
}) {
  return ProviderScope(
    overrides: [
      fileBrowserManagerProvider.overrideWith((ref) => manager),
    ],
    child: MaterialApp(
      theme: buildUxnanTheme(
        brightness: brightness,
        themeSource: ThemeSource.brand,
      ),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    ),
  );
}

FileBrowserManager _managerFor(String markdown) => FileBrowserManager(
      sendRequest: (method, [params]) async {
        if (method == 'workspace/readFile') {
          return RpcMessage.response(
            id: '1',
            result: {
              'path': 'CLAUDE.md',
              'content': markdown,
              'encoding': 'utf-8',
            },
          );
        }
        // git/diff returns an empty diff (markdown files don't have one).
        return RpcMessage.response(
          id: '1',
          result: const <String, dynamic>{},
        );
      },
    );

FileBrowserManager _imageManager() => FileBrowserManager(
      sendRequest: (method, [params]) async => RpcMessage.response(
        id: '1',
        result: const <String, dynamic>{
          'path': 'pixel.png',
          'base64Data':
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk'
                  '+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'mimeType': 'image/png',
        },
      ),
    );

void main() {
  testWidgets(
    'file viewer renders markdown samples without overflowing the app bar',
    (tester) async {
      // Phone-sized viewport so the layout matches real devices; the
      // default test viewport is 800 dp wide, which hides the regression.
      tester.view.physicalSize = const Size(1080, 2160);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      for (final sample in _markdownSamples) {
        final manager = _managerFor(sample);

        // Capture every layout / render exception so the test output
        // includes the offending widget's full stack trace (the default
        // FlutterError reporting is suppressed inside the test framework).
        final capturedErrors = <FlutterErrorDetails>[];
        final previousHandler = FlutterError.onError;
        FlutterError.onError = (details) {
          capturedErrors.add(details);
          previousHandler?.call(details);
        };

        try {
          await tester.pumpWidget(
            _wrap(
              child: const FileViewerScreen(cwd: '/tmp', path: 'CLAUDE.md'),
              manager: manager,
            ),
          );
          // Two pumps: one for the post-frame load, one for the resolution.
          await tester.pump();
          await tester.pump();

          if (capturedErrors.isNotEmpty) {
            fail(
              'Captured ${capturedErrors.length} error(s) while rendering '
              'sample:\n---\n$sample\n---\n${capturedErrors.map((d) {
                return '${d.exceptionAsString()}\n${d.stack}';
              }).join('\n----\n')}',
            );
          }
          expect(
            tester.takeException(),
            isNull,
            reason: 'Sample overflowed:\n$sample',
          );
        } finally {
          FlutterError.onError = previousHandler;
          await manager.dispose();
        }
      }
    },
  );

  testWidgets('text preview is selectable and has no copy app-bar action',
      (tester) async {
    final manager = _managerFor('void main() {}');
    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(cwd: '/tmp', path: 'main.dart'),
        manager: manager,
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byType(SelectableText), findsOneWidget);
    expect(find.byIcon(Icons.content_copy_outlined), findsNothing);
    await manager.dispose();
  });

  testWidgets('image preview fills the viewport and starts contained',
      (tester) async {
    final manager = _imageManager();
    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(cwd: '/tmp', path: 'pixel.png'),
        manager: manager,
      ),
    );
    await tester.pump();
    await tester.pump();

    final viewer = tester.widget<InteractiveViewer>(
      find.byType(InteractiveViewer),
    );
    final image = tester.widget<Image>(find.byType(Image));
    expect(viewer.clipBehavior, Clip.none);
    expect(viewer.minScale, 1);
    expect(image.fit, BoxFit.contain);
    await manager.dispose();
  });
}
