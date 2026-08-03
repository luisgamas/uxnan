import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_preview_support.dart';

void main() {
  group('previewKindForPath', () {
    test('recognizes every visual preview family case-insensitively', () {
      expect(previewKindForPath('README.MD'), FilePreviewKind.markdown);
      expect(previewKindForPath('assets/logo.SVG'), FilePreviewKind.svg);
      expect(previewKindForPath('docs/manual.PDF'), FilePreviewKind.pdf);
      expect(
        previewKindForPath('demo.GIF?raw=true'),
        FilePreviewKind.rasterImage,
      );
      expect(previewKindForPath('lib/main.dart'), FilePreviewKind.text);
    });
  });

  group('resolveWorkspaceResourcePath', () {
    test('resolves document-relative and workspace-root paths', () {
      expect(
        resolveWorkspaceResourcePath('docs/README.md', '../assets/demo.gif'),
        'assets/demo.gif',
      );
      expect(
        resolveWorkspaceResourcePath('docs/README.md', '/assets/logo.svg'),
        'assets/logo.svg',
      );
      expect(
        resolveWorkspaceResourcePath(
          'docs/README.md',
          'images/a%20b.png?raw=true#preview',
        ),
        'docs/images/a b.png',
      );
    });

    test('rejects workspace escapes, fragments, and external URLs', () {
      expect(
        resolveWorkspaceResourcePath('README.md', '../secret.png'),
        isNull,
      );
      expect(resolveWorkspaceResourcePath('README.md', '#install'), isNull);
      expect(
        resolveWorkspaceResourcePath('README.md', 'https://example.com/a.png'),
        isNull,
      );
    });
  });

  test('remote resources require HTTPS', () {
    expect(isSafeRemoteResource('https://img.shields.io/badge/x-y'), isTrue);
    expect(isSafeRemoteResource('http://example.com/image.png'), isFalse);
    expect(isSafeRemoteResource('data:image/png;base64,AA=='), isFalse);
  });

  group('normalizeReadmeHtml', () {
    test('converts centered headings, linked badges, and image sizes', () {
      const source = '''
<h1 align="center">Uxnan</h1>
<p align="center">
  <a href="https://github.com/example/actions"><img src="https://img.shields.io/badge/build-passing-green" alt="Build" height="20" /></a>
  <img src="assets/logo.svg" alt="Logo" width="72" />
</p>
''';

      final normalized = normalizeReadmeHtml(source);

      expect(normalized, contains('# Uxnan'));
      expect(
        normalized,
        contains(
          '[![Build](https://img.shields.io/badge/build-passing-green '
          '"uxnan-image-size:x20|")](https://github.com/example/actions)',
        ),
      );
      expect(
        normalized,
        contains(
          '![Logo](assets/logo.svg "uxnan-image-size:72x|")',
        ),
      );
      expect(normalized, isNot(contains('<img')));
    });

    test('preserves fenced code and removes embedded executable HTML', () {
      const fence = '```html\n<img src="do-not-convert.png" />\n```';
      final normalized = normalizeReadmeHtml(
        '$fence\n<script>alert("no")</script>\n<p>Safe</p>',
      );

      expect(normalized, contains(fence));
      expect(normalized, isNot(contains('alert')));
      expect(normalized, contains('Safe'));
    });
  });

  test('MarkdownImageMetadata decodes dimensions and title', () {
    final metadata = MarkdownImageMetadata.fromTitle(
      '${MarkdownImageMetadata.marker}72x20|Logo',
    );

    expect(metadata.width, 72);
    expect(metadata.height, 20);
    expect(metadata.title, 'Logo');
  });
}
