import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/conversation/files/file_preview_support.dart';
import 'package:uxnan/presentation/widgets/highlighted_source.dart';

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

  group('resolveMarkdownLinkAction', () {
    test('opens a workspace document in the viewer', () {
      final action = resolveMarkdownLinkAction('docs/README.md', '../LICENSE');

      expect(action, isA<OpenWorkspaceFile>());
      expect((action as OpenWorkspaceFile).path, 'LICENSE');
    });

    test('hands a web or mail address to the OS', () {
      for (final href in const [
        'https://example.com/docs',
        'http://example.com',
        'mailto:someone@example.com',
      ]) {
        expect(
          resolveMarkdownLinkAction('README.md', href),
          isA<OpenExternalLink>(),
          reason: href,
        );
      }
    });

    test('copies anything it will not launch', () {
      for (final href in const [
        '#installation',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'intent://scan/#Intent;scheme=zxing;end',
      ]) {
        expect(
          resolveMarkdownLinkAction('README.md', href),
          isA<CopyLinkTarget>(),
          reason: href,
        );
      }
    });
  });

  group('splitMarkdownBlocks', () {
    test('lifts GitHub alerts out of the document', () {
      final blocks = splitMarkdownBlocks(
        'intro\n\n> [!WARNING]\n> be careful\n> really\n\nafter',
      );

      expect(blocks, hasLength(3));
      expect((blocks[0] as MarkdownTextBlock).text.trim(), 'intro');
      final alert = blocks[1] as MarkdownAlertBlock;
      expect(alert.kind, MarkdownAlertKind.warning);
      expect(alert.body, 'be careful\nreally');
      expect((blocks[2] as MarkdownTextBlock).text.trim(), 'after');
    });

    test('leaves an ordinary quote and an unknown keyword alone', () {
      final blocks = splitMarkdownBlocks('> plain\n\n> [!NOPE]\n> body');

      expect(blocks.whereType<MarkdownAlertBlock>(), isEmpty);
      expect(blocks, hasLength(1));
    });

    test('never reads an alert or a disclosure inside fenced code', () {
      const source = '```md\n> [!NOTE]\n> inside\n<details>\n</details>\n```';
      final blocks = splitMarkdownBlocks(source);

      expect(blocks, hasLength(1));
      expect((blocks.single as MarkdownTextBlock).text, contains('[!NOTE]'));
    });

    test('extracts a details disclosure with its summary and open state', () {
      final blocks = splitMarkdownBlocks(
        '<details open>\n<summary><b>More</b></summary>\n\nbody\n\n</details>',
      );

      final details = blocks.whereType<MarkdownDetailsBlock>().single;
      expect(details.summary, '**More**');
      expect(details.body, 'body');
      expect(details.expanded, isTrue);
    });

    test('loses no line of a document that mixes every construct', () {
      const source = '''
# Title

<table>
<tr><td width="50%">

### Column heading
prose

</td><td width="50%">

<img src="demo.gif" />

</td></tr>
</table>

> [!TIP]
> a tip

<details>
<summary>Summary</summary>

folded body

</details>

closing paragraph
''';
      final blocks = splitMarkdownBlocks(source);
      final rendered = blocks.map((block) {
        return switch (block) {
          MarkdownTextBlock(:final text) => text,
          MarkdownAlertBlock(:final body) => body,
          MarkdownDetailsBlock(:final summary, :final body) =>
            '$summary\n$body',
        };
      }).join('\n');

      for (final needle in const [
        '# Title',
        '### Column heading',
        'prose',
        '<img src="demo.gif" />',
        'a tip',
        'Summary',
        'folded body',
        'closing paragraph',
      ]) {
        expect(rendered, contains(needle), reason: 'lost: $needle');
      }
    });

    test('keeps an unbalanced details tag as plain text', () {
      final blocks = splitMarkdownBlocks(
        '<details>\n<summary>x</summary>\nbody',
      );

      expect(blocks.whereType<MarkdownDetailsBlock>(), isEmpty);
    });
  });

  group('normalizeReadmeHtml GitHub extras', () {
    test('rewrites a simple HTML table as a pipe table', () {
      final normalized = normalizeReadmeHtml(
        '<table><tr><th>Agent</th><th>State</th></tr>'
        '<tr><td>Codex</td><td>wired</td></tr></table>',
      );

      expect(normalized, contains('| Agent | State |'));
      expect(normalized, contains('| --- | --- |'));
      expect(normalized, contains('| Codex | wired |'));
    });

    test('leaves a spanned table to the tag stripper', () {
      final normalized = normalizeReadmeHtml(
        '<table><tr><th>h</th></tr><tr><td colspan="2">wide</td></tr></table>',
      );

      expect(normalized, isNot(contains('| --- |')));
      expect(normalized, contains('wide'));
    });

    test('never squeezes a layout table into a pipe row', () {
      // The repository's own README: prose in one column, a demo GIF in the
      // other. Converting this loses the heading, the paragraph and the image
      // (its size metadata carries a `|`, which would split the row).
      final normalized = normalizeReadmeHtml('''
<table>
<tr>
<td width="46%" valign="top">

### Launch an agent
Some prose with a [link](docs/x.md).

</td>
<td width="54%" valign="top">

<img src="assets/shorts/launch-agent.gif" alt="demo" width="440" />

</td>
</tr>
</table>
''');

      expect(normalized, isNot(contains('| --- |')));
      expect(normalized, contains('### Launch an agent'));
      expect(normalized, contains('[link](docs/x.md)'));
      expect(normalized, contains('![demo](assets/shorts/launch-agent.gif'));
    });

    test('a header-less grid is not a data table', () {
      final normalized = normalizeReadmeHtml(
        '<table><tr><td>left</td><td>right</td></tr></table>',
      );

      expect(normalized, isNot(contains('| --- |')));
      expect(normalized, contains('left'));
      expect(normalized, contains('right'));
    });

    test('a kbd wrapping content keeps that content renderable', () {
      // READMEs use <kbd> as a chip around a logo + label; backticks there
      // would print the image's Markdown instead of drawing it.
      final normalized = normalizeReadmeHtml(
        '<kbd><img src="assets/agents/codex.svg" width="16" /> Codex</kbd>',
      );

      expect(normalized, contains('![](assets/agents/codex.svg'));
      expect(normalized, isNot(contains('`![')));
    });

    test('a <br> keeps its paragraph, so emphasis across it still applies', () {
      // A <br> at the end of a source line used to emit its own newline on top
      // of the line's own, leaving a blank line: the paragraph ended and the
      // bold opened before the <br> never closed, printing literal asterisks.
      final normalized = normalizeReadmeHtml('''
<p align="center">
  <b>first half<br />
  second half</b>
</p>
''');

      expect(normalized, contains('**first half'));
      expect(normalized, contains('second half**'));
      expect(
        normalized,
        isNot(contains(RegExp(r'first half\s*\n\s*\n'))),
        reason: 'a blank line here splits the paragraph and breaks the bold',
      );
      // The line break itself survives as Markdown's hard break.
      expect(normalized, contains('first half  \n'));
    });

    test('a <br> before a real blank line still starts a new paragraph', () {
      final normalized = normalizeReadmeHtml('one<br />\n\ntwo');

      expect(normalized, contains(RegExp(r'one\s*\n\s*\n\s*two')));
    });

    test('a sub/sup that cannot map keeps its inner formatting', () {
      final normalized = normalizeReadmeHtml('<sub><i>a footnote</i></sub>');

      expect(normalized, contains('_a footnote_'));
    });

    test('maps kbd, sub and sup onto Markdown equivalents', () {
      final normalized = normalizeReadmeHtml(
        '<kbd>Ctrl</kbd>+<kbd>C</kbd>, H<sub>2</sub>O, x<sup>2</sup>, '
        '<sup>note</sup>',
      );

      expect(normalized, contains('`Ctrl`+`C`'));
      expect(normalized, contains('H₂O'));
      expect(normalized, contains('x²'));
      // No superscript glyph exists for arbitrary words: keep the text.
      expect(normalized, contains('note'));
    });
  });

  group('languageIdForFence', () {
    test('normalizes common aliases and ignores fence metadata', () {
      expect(languageIdForFence('ts'), 'typescript');
      expect(languageIdForFence('YML'), 'yaml');
      expect(languageIdForFence('bash title="run"'), 'bash');
      expect(languageIdForFence(''), 'plaintext');
      expect(languageIdForFence('dart'), 'dart');
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
