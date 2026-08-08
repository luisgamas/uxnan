import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/media/remote_resource_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_viewer_screen.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/file_preview_media.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/markdown_blocks.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';
import 'package:uxnan/presentation/widgets/highlighted_source.dart';
import '../../support/ux_icon_finder.dart';

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
  RemoteResourceService? remoteResources,
  Brightness brightness = Brightness.dark,
}) {
  return ProviderScope(
    overrides: [
      fileBrowserManagerProvider.overrideWith((ref) => manager),
      if (remoteResources != null)
        remoteResourceServiceProvider.overrideWith((ref) => remoteResources),
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

FileBrowserManager _richMarkdownManager(List<String> imageRequests) =>
    FileBrowserManager(
      sendRequest: (method, [params]) async {
        if (method == 'workspace/readFile') {
          return RpcMessage.response(
            id: '1',
            result: const <String, dynamic>{
              'path': 'docs/README.md',
              'content': '''
<p align="center">
  <img src="../assets/badge.svg" alt="Build" width="88" />
</p>

![Demo](../assets/demo.gif?raw=true)
''',
              'encoding': 'utf-8',
            },
          );
        }
        if (method == 'workspace/readImage') {
          final path = params?['path']! as String;
          imageRequests.add(path);
          if (path.endsWith('.svg')) {
            return RpcMessage.response(
              id: '1',
              result: <String, dynamic>{
                'path': path,
                'base64Data':
                    'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmci'
                        'IHdpZHRoPSI4OCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9Ijg4'
                        'IiBoZWlnaHQ9IjIwIiBmaWxsPSJncmVlbiIvPjwvc3ZnPg==',
                'mimeType': 'image/svg+xml',
              },
            );
          }
          return RpcMessage.response(
            id: '1',
            result: <String, dynamic>{
              'path': path,
              'base64Data': 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
              'mimeType': 'image/gif',
            },
          );
        }
        return RpcMessage.response(
          id: '1',
          result: const <String, dynamic>{},
        );
      },
    );

/// README whose only media is the kind of shield GitHub projects put at the
/// top: an HTTPS badge served from an *extensionless* endpoint.
const _shieldReadme = '''
<p align="center">
  <a href="https://github.com/luisgamas/uxnan/stargazers"><img src="https://img.shields.io/github/stars/luisgamas/uxnan?style=flat-square" alt="GitHub stars" /></a>
</p>

# Uxnan
''';

const _shieldSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="20"> '
    '<rect width="88" height="20" fill="green"/></svg>';

/// Dio adapter that answers every request with [respond], so the viewer's
/// remote-resource path runs without a socket.
class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.respond);

  final ResponseBody Function() respond;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async =>
      respond();

  @override
  void close({bool force = false}) {}
}

/// Stand-in for a network failure raised by the stubbed adapter.
class _TransportFailure implements Exception {
  const _TransportFailure();
}

RemoteResourceService _remoteResources(ResponseBody Function() respond) {
  final dio = Dio(BaseOptions(responseType: ResponseType.bytes))
    ..httpClientAdapter = _StubAdapter(respond);
  return RemoteResourceService(client: dio);
}

/// A README built from the constructs real projects actually ship.
const _realWorldReadme = '''
<h1 align="center">Project</h1>

<p align="center">
  <img src="assets/logo.svg" alt="Logo" width="72" />
  <a href="https://example.com"><img src="https://img.shields.io/badge/a-b-blue" alt="badge" /></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/dark.png" />
  <img src="assets/hero.png" alt="Hero" width="600" />
</picture>

<table>
<tr>
<td width="46%" valign="top">

### Launch an agent
Prose with a [link](docs/x.md).

</td>
<td width="54%" valign="top">

<img src="assets/demo.gif" alt="demo" width="440" />

</td>
</tr>
</table>

<kbd><img src="assets/agents/codex.svg" width="16" /> Codex</kbd> and press
<kbd>Ctrl</kbd>.

> [!IMPORTANT]
> Read this first.

<details>
<summary>More</summary>

folded content

</details>

<table><tr><th>Key</th><th>Value</th></tr><tr><td>a</td><td>b</td></tr></table>

- [x] done
- [ ] pending
  - nested item

```nushell
ls | where size > 10mb
```
''';

FileBrowserManager _realWorldManager(List<String> imageRequests) =>
    FileBrowserManager(
      sendRequest: (method, [params]) async {
        if (method == 'workspace/readFile') {
          return RpcMessage.response(
            id: '1',
            result: const {
              'path': 'README.md',
              'content': _realWorldReadme,
              'encoding': 'utf-8',
            },
          );
        }
        if (method == 'workspace/readImage') {
          final path = params?['path']! as String;
          imageRequests.add(path);
          final isSvg = path.toLowerCase().endsWith('.svg');
          return RpcMessage.response(
            id: '1',
            result: <String, dynamic>{
              'path': path,
              'base64Data': isSvg
                  ? 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmci'
                      'IHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg=='
                  : 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
              'mimeType': isSvg ? 'image/svg+xml' : 'image/gif',
            },
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

FileBrowserManager _svgManager() => FileBrowserManager(
      sendRequest: (method, [params]) async {
        if (method == 'workspace/readImage') {
          return RpcMessage.response(
            id: '1',
            result: const <String, dynamic>{
              'path': 'assets/logo.svg',
              'base64Data':
                  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdp'
                      'ZHRoPSIxNiIgaGVpZ2h0PSIxNiIvPg==',
              'mimeType': 'image/svg+xml',
            },
          );
        }
        if (method == 'workspace/readFile') {
          return RpcMessage.response(
            id: '1',
            result: const <String, dynamic>{
              'path': 'assets/logo.svg',
              'content': '<svg width="16" height="16" />',
              'encoding': 'utf-8',
            },
          );
        }
        return RpcMessage.response(
          id: '1',
          result: const <String, dynamic>{},
        );
      },
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
    expect(findUxIcon(UxIcons.contentCopy), findsNothing);
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

  testWidgets('markdown preview is constrained on a tablet viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    final manager = _managerFor(_markdownSamples[1]);

    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(cwd: '/tmp', path: 'README.md'),
        manager: manager,
      ),
    );
    await tester.pump();
    await tester.pump();

    final markdown = find.byType(MarkdownBody);
    expect(markdown, findsOneWidget);
    expect(tester.getSize(markdown).width, lessThanOrEqualTo(760));
    await manager.dispose();
  });

  testWidgets('markdown loads relative SVG badges and animated GIF resources',
      (tester) async {
    final requests = <String>[];
    final manager = _richMarkdownManager(requests);
    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(
          cwd: '/tmp',
          path: 'docs/README.md',
        ),
        manager: manager,
      ),
    );
    await tester.pump();
    await tester.pump();
    await tester.pump();

    expect(
      requests,
      containsAll(<String>['assets/badge.svg', 'assets/demo.gif']),
    );
    expect(find.byType(WorkspaceVectorImage), findsOneWidget);
    final badge = tester.widget<WorkspaceVectorImage>(
      find.byType(WorkspaceVectorImage),
    );
    // The document declared a width, so the shield keeps its own aspect ratio
    // instead of being letterboxed into the default badge height.
    expect(badge.width, 88);
    expect(badge.height, isNull);
    final gif = tester.widget<Image>(find.byType(Image));
    expect(gif.gaplessPlayback, isTrue);
    await manager.dispose();
  });

  testWidgets('markdown renders an extensionless remote shield as a vector',
      (tester) async {
    final manager = _managerFor(_shieldReadme);
    final remote = _remoteResources(
      () => ResponseBody.fromBytes(
        utf8.encode(_shieldSvg),
        200,
        headers: {
          Headers.contentTypeHeader: ['image/svg+xml;charset=utf-8'],
        },
      ),
    );
    addTearDown(remote.dispose);

    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(cwd: '/tmp', path: 'README.md'),
        manager: manager,
        remoteResources: remote,
      ),
    );
    await tester.pump();
    // Duration pumps so the stubbed HTTP round-trip settles before the assert.
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));

    // The URL carries no `.svg`; only the response body identifies the format,
    // so a raster decoder here would render the badge as a broken image.
    expect(find.byType(WorkspaceVectorImage), findsOneWidget);
    final badge = tester.widget<WorkspaceVectorImage>(
      find.byType(WorkspaceVectorImage),
    );
    expect(badge.height, 20);
    expect(findUxIcon(UxIcons.brokenImage), findsNothing);
    await manager.dispose();
  });

  testWidgets('a badge-sized slot that fails to load never overflows',
      (tester) async {
    tester.view.physicalSize = const Size(1080, 2160);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    final manager = _managerFor(_shieldReadme);
    final remote = _remoteResources(() => throw const _TransportFailure());
    addTearDown(remote.dispose);

    final capturedErrors = <FlutterErrorDetails>[];
    final previousHandler = FlutterError.onError;
    FlutterError.onError = capturedErrors.add;
    try {
      await tester.pumpWidget(
        _wrap(
          child: const FileViewerScreen(cwd: '/tmp', path: 'README.md'),
          manager: manager,
          remoteResources: remote,
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 50));

      // The shield's slot is 20dp tall, so the padded placeholder column used
      // to overflow it by 20 pixels; the compact glyph fits.
      expect(findUxIcon(UxIcons.brokenImage), findsOneWidget);
      expect(
        capturedErrors,
        isEmpty,
        reason: capturedErrors.map((d) => d.exceptionAsString()).join('\n'),
      );
      expect(tester.takeException(), isNull);
    } finally {
      FlutterError.onError = previousHandler;
      await manager.dispose();
    }
  });

  testWidgets('GitHub alerts render as titled callouts, quotes do not',
      (tester) async {
    final manager = _managerFor(
      '> [!NOTE]\n> take note\n\n> [!CAUTION]\n> be careful\n\n> plain quote',
    );
    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(cwd: '/tmp', path: 'README.md'),
        manager: manager,
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byType(MarkdownAlertCard), findsNWidgets(2));
    expect(find.text('Note'), findsOneWidget);
    expect(find.text('Caution'), findsOneWidget);
    // The keyword is chrome, not body text.
    expect(find.textContaining('[!NOTE]'), findsNothing);
    expect(find.textContaining('take note'), findsOneWidget);
    expect(find.textContaining('plain quote'), findsOneWidget);
    await manager.dispose();
  });

  testWidgets('a details disclosure hides its body until tapped',
      (tester) async {
    final manager = _managerFor(
      '<details>\n<summary>Show more</summary>\n\nhidden body\n\n</details>',
    );
    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(cwd: '/tmp', path: 'README.md'),
        manager: manager,
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('Show more'), findsOneWidget);
    expect(find.textContaining('hidden body'), findsNothing);

    await tester.tap(find.byType(MarkdownDetailsTile));
    await tester.pump();

    expect(find.textContaining('hidden body'), findsOneWidget);
    await manager.dispose();
  });

  testWidgets('task lists, HTML tables and fenced code follow GitHub',
      (tester) async {
    final manager = _managerFor('''
- [x] done
- [ ] pending

<table><tr><th>Agent</th></tr><tr><td>Codex</td></tr></table>

```dart
void main() {}
```
''');
    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(cwd: '/tmp', path: 'README.md'),
        manager: manager,
      ),
    );
    await tester.pump();
    await tester.pump();

    // A checked box is visually distinct from an empty one.
    expect(findUxIcon(UxIcons.checkBox), findsOneWidget);
    expect(findUxIcon(UxIcons.checkBoxOutlineBlank), findsOneWidget);
    // The HTML table became a real table rather than a run of loose lines.
    expect(find.byType(Table), findsOneWidget);
    // The fence is highlighted and scrolls instead of being clipped.
    expect(find.byType(HighlightedSource), findsOneWidget);
    await manager.dispose();
  });

  testWidgets('a real-world README shape renders whole, with nothing dropped',
      (tester) async {
    // Distilled from the constructs that actually appear in widely-used
    // READMEs (centered header, badge row, layout table with a demo image,
    // <picture>, <kbd> chips, disclosures, alerts, data table, task list,
    // nested lists, odd fence languages). The point is not any single feature
    // but that adding GitHub support never costs the document its content.
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final requests = <String>[];
    final manager = _realWorldManager(requests);
    final captured = <FlutterErrorDetails>[];
    final previousHandler = FlutterError.onError;
    FlutterError.onError = captured.add;
    try {
      await tester.pumpWidget(
        _wrap(
          child: const FileViewerScreen(cwd: '/tmp', path: 'README.md'),
          manager: manager,
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 40));

      // Layout tables keep their prose and their media: the heading survives
      // as a heading, and the demo image is still requested from the bridge.
      expect(find.text('Launch an agent'), findsOneWidget);
      expect(requests, contains('assets/demo.gif'));
      // A <kbd> chip around a logo keeps the logo; a key label becomes code.
      expect(requests, contains('assets/agents/codex.svg'));
      // GitHub constructs still work in the same document.
      expect(find.byType(MarkdownAlertCard), findsOneWidget);
      expect(find.byType(MarkdownDetailsTile), findsOneWidget);
      expect(find.byType(Table), findsOneWidget);
      expect(findUxIcon(UxIcons.checkBox), findsOneWidget);

      expect(
        captured,
        isEmpty,
        reason: captured.map((d) => d.exceptionAsString()).join('\n'),
      );
      expect(tester.takeException(), isNull);
    } finally {
      FlutterError.onError = previousHandler;
      await manager.dispose();
    }
  });

  testWidgets('SVG files can switch between preview and editable source',
      (tester) async {
    final manager = _svgManager();
    await tester.pumpWidget(
      _wrap(
        child: const FileViewerScreen(
          cwd: '/tmp',
          path: 'assets/logo.svg',
        ),
        manager: manager,
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byType(WorkspaceVectorImage), findsOneWidget);
    expect(findUxIcon(UxIcons.code), findsOneWidget);

    await tester.tap(findUxIcon(UxIcons.code));
    await tester.pump();

    expect(find.byType(SelectableText), findsOneWidget);
    expect(findUxIcon(UxIcons.edit), findsOneWidget);
    await manager.dispose();
  });
}
