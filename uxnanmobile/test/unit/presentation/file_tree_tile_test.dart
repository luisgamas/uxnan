import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/presentation/screens/conversation/files/widgets/file_tree_tile.dart';

void main() {
  IconData iconFor(String name, {FileEntryType type = FileEntryType.file}) =>
      fileTypeVisuals(name: name, type: type).icon;

  group('fileTypeVisuals', () {
    test('directories always get the folder glyph', () {
      expect(
        iconFor('anything', type: FileEntryType.dir),
        Icons.folder_outlined,
      );
    });

    test('well-known filenames win over extensions', () {
      expect(iconFor('README.md'), Icons.menu_book_outlined);
      expect(iconFor('LICENSE'), Icons.gavel_outlined);
      expect(iconFor('Dockerfile'), Icons.inventory_2_outlined);
      expect(iconFor('Makefile'), Icons.build_outlined);
      expect(iconFor('.gitignore'), Icons.settings_outlined);
      expect(iconFor('.env.local'), Icons.key_outlined);
    });

    test('source files map to the code glyph', () {
      for (final name in ['main.dart', 'app.tsx', 'server.go', 'lib.rs']) {
        expect(iconFor(name), Icons.code_rounded, reason: name);
      }
    });

    test('media, data and archive families get distinct glyphs', () {
      expect(iconFor('logo.png'), Icons.image_outlined);
      expect(iconFor('config.json'), Icons.data_object_rounded);
      expect(iconFor('data.csv'), Icons.table_chart_outlined);
      expect(iconFor('bundle.tar.gz'), Icons.folder_zip_outlined);
      expect(iconFor('clip.mp4'), Icons.movie_outlined);
      expect(iconFor('font.woff2'), Icons.font_download_outlined);
    });

    test('unknown extensions fall back to the generic file glyph', () {
      expect(iconFor('mystery.qzx'), Icons.insert_drive_file_outlined);
    });
  });
}
