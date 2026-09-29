import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/widgets/path_text.dart';

/// A long path loses its BEGINNING, never its end: the leading folders are the
/// same for every project on the PC, and the tail is what tells them apart.
Future<void> main() async {
  // One "pixel" per character, so the rule is visible without a font.
  bool Function(String) upTo(int chars) => (text) => text.length <= chars;

  group('fitPathTail', () {
    const path = '/Users/me/Documents/Projects/mobile-app';

    test('a path that fits is left alone', () {
      expect(fitPathTail(path, maxWidth: 100, fits: upTo(100)), path);
    });

    test('cuts at the earliest folder boundary that fits', () {
      expect(
        fitPathTail(path, maxWidth: 30, fits: upTo(30)),
        '…/Projects/mobile-app',
      );
      expect(
        fitPathTail(path, maxWidth: 15, fits: upTo(15)),
        '…/mobile-app',
      );
    });

    test('keeps the end of a last name too long on its own', () {
      expect(fitPathTail(path, maxWidth: 6, fits: upTo(6)), '…e-app');
    });

    test('reads Windows paths the same way', () {
      expect(
        fitPathTail(
          r'C:\Users\me\dev\api-server',
          maxWidth: 14,
          fits: upTo(14),
        ),
        r'…\api-server',
      );
    });
  });

  testWidgets('shows the tail on a narrow line and announces the whole path',
      (tester) async {
    const path = '/Users/me/Documents/Projects/very-long-folder/mobile-app';
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 160,
              child: PathText(path, style: TextStyle(fontSize: 12)),
            ),
          ),
        ),
      ),
    );

    final shown = tester.widget<Text>(find.byType(Text)).data!;
    expect(shown, startsWith('…'));
    expect(shown, endsWith('/mobile-app'));
    expect(find.bySemanticsLabel(path), findsOneWidget);
  });
}
