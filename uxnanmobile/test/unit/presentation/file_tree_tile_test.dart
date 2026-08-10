import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/file_tree_tile.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';

void main() {
  UxIconData iconFor(String name, {FileEntryType type = FileEntryType.file}) =>
      fileTypeVisuals(name: name, type: type).icon;

  /// Pumps a [FileTreeTile] for [node] and returns the style applied to its
  /// name label, capturing the active [ColorScheme] for theme-relative asserts.
  Future<({TextStyle style, ColorScheme scheme})> nameStyle(
    WidgetTester tester,
    FileTreeNode node,
  ) async {
    late ColorScheme scheme;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              scheme = Theme.of(context).colorScheme;
              return FileTreeTile(
                node: node,
                depth: 0,
                showExtension: true,
                onTap: () {},
              );
            },
          ),
        ),
      ),
    );
    final text = tester.widget<Text>(
      find.text(node.displayName(showExtension: true)),
    );
    return (style: text.style!, scheme: scheme);
  }

  group('FileTreeTile git visuals', () {
    testWidgets('compact rows preserve the 48 dp minimum touch target', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FileTreeTile(
              node: const FileTreeNode(
                name: 'main.dart',
                path: 'main.dart',
                type: FileEntryType.file,
              ),
              depth: 0,
              showExtension: true,
              showDetails: false,
              compact: true,
              onTap: () {},
            ),
          ),
        ),
      );

      expect(
        tester.getSize(find.byType(FileTreeTile)).height,
        greaterThanOrEqualTo(48),
      );
    });

    testWidgets('untracked uses the conventional git colour, upright', (
      tester,
    ) async {
      final r = await nameStyle(
        tester,
        const FileTreeNode(
          name: 'new.dart',
          path: 'new.dart',
          type: FileEntryType.file,
          gitStatus: GitFileStatus.untracked,
        ),
      );
      // Untracked is a real git state → coloured (not the dimmed treatment) and
      // never italic; italic is reserved for ignored entries.
      expect(r.style.color, UxnanColors.gitUntracked);
      expect(r.style.fontStyle, isNot(FontStyle.italic));
    });

    testWidgets('modified uses the amber git token', (tester) async {
      final r = await nameStyle(
        tester,
        const FileTreeNode(
          name: 'a.dart',
          path: 'a.dart',
          type: FileEntryType.file,
          gitStatus: GitFileStatus.modified,
        ),
      );
      expect(r.style.color, UxnanColors.gitModified);
      expect(r.style.fontStyle, isNot(FontStyle.italic));
    });

    testWidgets('ignored entries are dimmed: muted tone + italic', (
      tester,
    ) async {
      final r = await nameStyle(
        tester,
        const FileTreeNode(
          name: '.env',
          path: '.env',
          type: FileEntryType.file,
          ignored: true,
        ),
      );
      expect(r.style.fontStyle, FontStyle.italic);
      expect(r.style.color, r.scheme.onSurfaceVariant);
    });

    testWidgets('a clean tracked file is upright in the regular tone', (
      tester,
    ) async {
      final r = await nameStyle(
        tester,
        const FileTreeNode(
          name: 'b.dart',
          path: 'b.dart',
          type: FileEntryType.file,
        ),
      );
      expect(r.style.color, r.scheme.onSurface);
      expect(r.style.fontStyle, isNot(FontStyle.italic));
    });
  });

  group('fileTypeVisuals', () {
    test('directories always get the folder glyph', () {
      expect(
        iconFor('anything', type: FileEntryType.dir),
        UxIcons.folder,
      );
    });

    test('well-known filenames win over extensions', () {
      expect(iconFor('README.md'), UxIcons.menuBook);
      expect(iconFor('LICENSE'), UxIcons.gavel);
      expect(iconFor('Dockerfile'), UxIcons.inventory2);
      expect(iconFor('Makefile'), UxIcons.build);
      expect(iconFor('.gitignore'), UxIcons.settings);
      expect(iconFor('.env.local'), UxIcons.key);
    });

    test('source files map to the code glyph', () {
      for (final name in ['main.dart', 'app.tsx', 'server.go', 'lib.rs']) {
        expect(iconFor(name), UxIcons.code, reason: name);
      }
    });

    test('media, data and archive families get distinct glyphs', () {
      expect(iconFor('logo.png'), UxIcons.image);
      expect(iconFor('config.json'), UxIcons.dataObject);
      expect(iconFor('data.csv'), UxIcons.tableChart);
      expect(iconFor('bundle.tar.gz'), UxIcons.folderZip);
      expect(iconFor('clip.mp4'), UxIcons.movie);
      expect(iconFor('font.woff2'), UxIcons.fontDownload);
    });

    test('unknown extensions fall back to the generic file glyph', () {
      expect(iconFor('mystery.qzx'), UxIcons.insertDriveFile);
    });
  });
}
