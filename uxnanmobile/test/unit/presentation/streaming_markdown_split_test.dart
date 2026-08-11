import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/conversation/messages/streaming_markdown_split.dart';

/// The split exists to stop a streamed reply re-parsing itself on every delta.
/// Its whole risk is fidelity: Markdown cut in the wrong place renders
/// differently from the same Markdown whole. These pin the places it must
/// refuse to cut.
void main() {
  /// Nothing may ever be lost or reordered, whatever the input.
  void expectLossless(String source) {
    expect(
      splitStreamingMarkdown(source).join(),
      source,
      reason: 'the chunks must rejoin into exactly the source',
    );
  }

  test('empty input yields no chunks', () {
    expect(splitStreamingMarkdown(''), isEmpty);
  });

  test('prose with no blank line is one growing chunk', () {
    const source = 'Una sola línea que todavía se está escribiendo';
    expect(splitStreamingMarkdown(source), [source]);
    expectLossless(source);
  });

  test('paragraphs split, and the last one is the tail', () {
    const source =
        'Primer párrafo.\n\nSegundo párrafo.\n\nTercero a medio escr';
    final chunks = splitStreamingMarkdown(source);
    expect(chunks, [
      'Primer párrafo.\n\n',
      'Segundo párrafo.\n\n',
      'Tercero a medio escr',
    ]);
    expectLossless(source);
  });

  test('a heading starts a fresh chunk', () {
    const source = 'Intro.\n\n## Título\n\nCuerpo.';
    expect(splitStreamingMarkdown(source), [
      'Intro.\n\n',
      '## Título\n\n',
      'Cuerpo.',
    ]);
    expectLossless(source);
  });

  group('never cuts where the pieces would render differently', () {
    test('inside a fenced code block, blank lines and all', () {
      const source =
          'Mira:\n\n```dart\nvoid main() {\n\n  print(1);\n}\n```\n\nYa está.';
      final chunks = splitStreamingMarkdown(source);
      expect(chunks, [
        'Mira:\n\n',
        '```dart\nvoid main() {\n\n  print(1);\n}\n```\n\n',
        'Ya está.',
      ]);
      expectLossless(source);
    });

    test('an unterminated fence keeps everything after it in the tail', () {
      // Exactly what a reply looks like mid-code-block.
      const source = 'Ejemplo:\n\n```dart\nvoid main() {\n\n  print(';
      expect(splitStreamingMarkdown(source), [
        'Ejemplo:\n\n',
        '```dart\nvoid main() {\n\n  print(',
      ]);
      expectLossless(source);
    });

    // These stay whole. The rule refuses to cut before ANY line that could
    // continue the block above it, which also means it does not cut where a
    // list or table merely BEGINS. That costs a missed optimization — a
    // list-heavy reply simply does not split — and never costs fidelity, which
    // is the right way round: a wrong cut is visible, a missing one is not.
    test('between the items of a loose list (it would become two lists)', () {
      const source = 'Pasos:\n\n- uno\n\n- dos\n\n- tres';
      expect(splitStreamingMarkdown(source), [source]);
      expectLossless(source);
    });

    test('between numbered list items', () {
      const source = 'Orden:\n\n1. uno\n\n2. dos';
      expect(splitStreamingMarkdown(source), [source]);
      expectLossless(source);
    });

    test('inside a blockquote', () {
      const source = 'Dijo:\n\n> una cosa\n\n> y otra';
      expect(splitStreamingMarkdown(source), [source]);
      expectLossless(source);
    });

    test('inside a table', () {
      const source = 'Tabla:\n\n| a | b |\n| - | - |\n\n| 1 | 2 |';
      expect(splitStreamingMarkdown(source), [source]);
      expectLossless(source);
    });

    test('before an indented code block', () {
      const source = 'Así:\n\n    codigo indentado\n\n    y mas';
      expect(splitStreamingMarkdown(source), [source]);
      expectLossless(source);
    });

    test('before a link reference definition', () {
      const source = 'Ver [el doc][d].\n\n[d]: https://example.com';
      expect(splitStreamingMarkdown(source), [source]);
      expectLossless(source);
    });
  });

  test('trailing blank lines stay in the tail, never becoming a chunk', () {
    // The reply has not written what comes after them yet.
    const source = 'Un párrafo.\n\n';
    expect(splitStreamingMarkdown(source), [source]);
    expectLossless(source);
  });

  test('a settled chunk never changes as the reply grows', () {
    // The property the widget cache depends on: appending text may only ever
    // rewrite the LAST chunk.
    const growing = [
      'Primero.',
      'Primero.\n\nSegu',
      'Primero.\n\nSegundo.',
      'Primero.\n\nSegundo.\n\n## Tres',
      'Primero.\n\nSegundo.\n\n## Tres\n\nFinal.',
    ];
    var previous = splitStreamingMarkdown(growing.first);
    for (final source in growing.skip(1)) {
      final next = splitStreamingMarkdown(source);
      expectLossless(source);
      for (var i = 0; i < previous.length - 1; i += 1) {
        expect(
          next[i],
          previous[i],
          reason: 'chunk $i changed after more text arrived',
        );
      }
      previous = next;
    }
  });

  test('CRLF input is preserved verbatim', () {
    const source = 'Uno.\r\n\r\nDos.';
    expectLossless(source);
    expect(splitStreamingMarkdown(source), ['Uno.\r\n\r\n', 'Dos.']);
  });
}
