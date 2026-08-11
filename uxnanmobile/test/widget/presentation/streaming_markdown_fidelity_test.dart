import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/conversation/messages/streaming_markdown_split.dart';
import 'package:uxnan/presentation/theme/markdown.dart';

/// The premise of the streaming split is that Markdown rendered in pieces looks
/// exactly like the same Markdown rendered whole. Asserting the chunk strings
/// proves the cut is where it was meant to be; only pixels prove it is
/// invisible, which is the thing that would actually reach the user.
///
/// The test font renders every glyph as a box, which is what makes this a
/// LAYOUT comparison: identical text either lays out the same or it does not.
void main() {
  const width = 360.0;

  Future<Uint8List> render(WidgetTester tester, Widget child) async {
    // A long reply is thousands of pixels tall; the default 600x800 surface
    // would clip it and compare two truncated images.
    tester.view.physicalSize = const Size(720, 24000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final key = GlobalKey();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: RepaintBoundary(
              key: key,
              child: SizedBox(width: width, child: child),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    late Uint8List bytes;
    await tester.runAsync(() async {
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage();
      final data = await image.toByteData();
      bytes = data!.buffer.asUint8List();
    });
    return bytes;
  }

  Widget whole(String source) => Builder(
        builder: (context) => MarkdownBody(
          data: source,
          styleSheet: uxnanMarkdownStyleSheet(context),
        ),
      );

  // Mirrors what `_StreamingProse` builds: one body per chunk, with the
  // renderer's own block spacing put back between them.
  Widget split(String source) => Builder(
        builder: (context) {
          final chunks = splitStreamingMarkdown(source);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var i = 0; i < chunks.length; i += 1) ...[
                if (i > 0) SizedBox(height: uxnanMarkdownBlockSpacing(context)),
                MarkdownBody(
                  data: chunks[i],
                  styleSheet: uxnanMarkdownStyleSheet(context),
                ),
              ],
            ],
          );
        },
      );

  Future<void> expectIdentical(WidgetTester tester, String source) async {
    // More than one chunk, or the comparison proves nothing.
    expect(
      splitStreamingMarkdown(source).length,
      greaterThan(1),
      reason: 'this source should exercise the split',
    );
    final a = await render(tester, whole(source));
    final b = await render(tester, split(source));
    expect(b.length, a.length, reason: 'the split changed the rendered height');
    var differing = 0;
    for (var i = 0; i < a.length; i += 1) {
      if (a[i] != b[i]) differing += 1;
    }
    expect(differing, 0, reason: '$differing bytes differ between the two');
  }

  testWidgets('paragraphs render identically split or whole', (tester) async {
    await expectIdentical(
      tester,
      'El bridge abre un canal cifrado con el teléfono.\n\n'
      'Cada turno del agente viaja por ese canal como una serie de '
      'notificaciones.\n\n'
      'El teléfono las va aplicando a la conversación activa.',
    );
  });

  testWidgets('a heading between paragraphs renders identically',
      (tester) async {
    await expectIdentical(
      tester,
      'Antes del handshake.\n\n'
      '## Cómo funciona\n\n'
      'Después del handshake, ya con clave de sesión.',
    );
  });

  testWidgets('a fenced code block renders identically', (tester) async {
    await expectIdentical(
      tester,
      'Ejemplo mínimo:\n\n'
      '```dart\n'
      'void main() {\n'
      '  print(1);\n'
      '}\n'
      '```\n\n'
      'Y eso es todo.',
    );
  });

  testWidgets('a reply the size of the measured problem renders identically',
      (tester) async {
    // ~5 000 characters is where the device measurement showed the cost turning
    // into visible jank, so it is the shape this work exists for.
    final buffer = StringBuffer();
    for (var i = 0; i < 40; i += 1) {
      buffer.write(
        'Párrafo número $i con texto suficiente para ocupar varias líneas '
        'cuando se dibuja en el ancho de un teléfono y así ejercitar el '
        'layout de verdad.\n\n',
      );
    }
    await expectIdentical(tester, buffer.toString().trimRight());
  });
}
