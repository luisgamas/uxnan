import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/widgets/ne_dashed_outline.dart';

/// Renders [NeDashedOutline] and inspects the resulting PIXELS.
///
/// A test that only pumped the widget would pass on an outline that paints
/// nothing at all, or on a solid border — the two failures that actually
/// matter here. So each case rasterizes the bubble and reads the image back.
///
/// `toImage`/`toByteData` are real async work, and a widget test's clock is
/// fake: without [WidgetTester.runAsync] they never complete and the test just
/// hangs until it times out.
void main() {
  const outlineColor = Color(0xFFFF0000);
  const fill = Color(0xFF202020);
  const radius = BorderRadius.all(Radius.circular(12));
  const width = 200.0;
  const height = 60.0;

  Widget harness(GlobalKey key, Color color) => MaterialApp(
        home: Scaffold(
          backgroundColor: Colors.black,
          body: Center(
            child: RepaintBoundary(
              key: key,
              child: NeDashedOutline(
                color: color,
                borderRadius: radius,
                child: Container(
                  width: width,
                  height: height,
                  decoration: const BoxDecoration(
                    color: fill,
                    borderRadius: radius,
                  ),
                ),
              ),
            ),
          ),
        ),
      );

  Future<ByteData> rasterize(WidgetTester tester, Color color) async {
    final key = GlobalKey();
    await tester.pumpWidget(harness(key, color));
    await tester.pump();
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    late ByteData bytes;
    await tester.runAsync(() async {
      final image = await boundary.toImage();
      // Default format is rawRgba: 4 bytes per pixel, which `scanRow` indexes.
      bytes = (await image.toByteData())!;
      image.dispose();
    });
    return bytes;
  }

  /// Scans one horizontal line and reports the stroke pixels on it, plus how
  /// many separate runs they form — the number of dashes crossed.
  ({int strokePixels, int runs}) scanRow(ByteData bytes, int row) {
    var strokePixels = 0;
    var runs = 0;
    var inRun = false;
    for (var x = 0; x < width.toInt(); x++) {
      final offset = (width.toInt() * row + x) * 4;
      final r = bytes.getUint8(offset);
      final g = bytes.getUint8(offset + 1);
      final b = bytes.getUint8(offset + 2);
      final isStroke = r > 140 && g < 110 && b < 110;
      if (isStroke) {
        strokePixels++;
        if (!inRun) {
          runs++;
          inRun = true;
        }
      } else {
        inRun = false;
      }
    }
    return (strokePixels: strokePixels, runs: runs);
  }

  testWidgets('paints an interrupted outline, not a solid border',
      (tester) async {
    final bytes = await rasterize(tester, outlineColor);
    // Row 1: inside the half-stroke inset, so the top edge is on this line.
    final scan = scanRow(bytes, 1);

    expect(
      scan.strokePixels,
      greaterThan(0),
      reason: 'the outline painted nothing at all',
    );
    expect(
      scan.runs,
      greaterThan(3),
      reason: 'expected several dashes along the top edge, got ${scan.runs}',
    );
    expect(
      scan.strokePixels,
      lessThan(width.toInt() - 10),
      reason: 'the "dashes" cover the whole edge — this is a solid border',
    );
  });

  testWidgets('leaves the bubble untouched when transparent', (tester) async {
    // This is the delivered state: the dashes dissolve and the bubble is an
    // ordinary one, with nothing painted over it.
    final bytes = await rasterize(tester, Colors.transparent);
    expect(scanRow(bytes, 1).strokePixels, 0);
  });

  testWidgets('dashes the whole perimeter, not just the top', (tester) async {
    final bytes = await rasterize(tester, outlineColor);
    // Guards a painter that strokes only the first path segment: the bottom
    // edge must be dashed the same way the top is.
    final bottom = scanRow(bytes, height.toInt() - 2);
    expect(bottom.strokePixels, greaterThan(0));
    expect(bottom.runs, greaterThan(3));
  });
}
