import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// [UxIcon] must ink the same fraction of its box as the Material icon it
/// replaced, or every layout in the app is off by the difference.
///
/// This reads PIXELS rather than trusting either package's specs: Hugeicons
/// paints its artwork edge to edge at the size it is given, while a Material
/// glyph inks the classic 18-in-24 live area, so the same nominal `size` used
/// to arrive ~15% larger. `UxIcon._opticalScale` corrects that, and this is
/// what proves it still does — after a package upgrade changes the viewBox, or
/// after someone "simplifies" the scale away.
Future<void> main() async {
  Future<double> inkRatio(WidgetTester tester, Widget icon, double box) async {
    final key = GlobalKey();
    await tester.pumpWidget(
      MaterialApp(
        home: Center(
          child: RepaintBoundary(
            key: key,
            child: ColoredBox(
              color: const Color(0xFFFFFFFF),
              child: SizedBox(width: box, height: box, child: icon),
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
      final image = await boundary.toImage(pixelRatio: 4);
      final data = await image.toByteData();
      bytes = data!.buffer.asUint8List();
    });
    final side = (box * 4).round();
    var minX = side;
    var maxX = -1;
    var minY = side;
    var maxY = -1;
    for (var y = 0; y < side; y++) {
      for (var x = 0; x < side; x++) {
        final p = (y * side + x) * 4;
        // any pixel darker than near-white counts as ink
        if (bytes[p] < 200) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return 0;
    return ((maxX - minX + 1) / (box * 4) + (maxY - minY + 1) / (box * 4)) / 2;
  }

  testWidgets('inks the same extent as the Material icon it replaced',
      (tester) async {
    for (final size in [16.0, 20.0, 22.0, 24.0]) {
      final material = await inkRatio(
        tester,
        Icon(Icons.folder_outlined, size: size, color: Colors.black),
        size,
      );
      final ours = await inkRatio(
        tester,
        UxIcon(UxIcons.folder, size: size, color: Colors.black),
        size,
      );
      expect(
        ours,
        closeTo(material, 0.03),
        reason: 'at ${size}dp: Material inks $material, UxIcon inks $ours',
      );
    }
  });

  testWidgets('occupies its full nominal size, so nothing reflows',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Center(child: UxIcon(UxIcons.folder, size: 24))),
    );

    // The artwork shrinks; the BOX does not. A widget that shrank with its
    // glyph would quietly re-space every row it sits in.
    expect(tester.getSize(find.byType(UxIcon)), const Size(24, 24));
  });
}
