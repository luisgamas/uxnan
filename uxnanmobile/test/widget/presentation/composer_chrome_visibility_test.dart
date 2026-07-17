import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_chrome_visibility.dart';

Widget _wrap({required bool visible}) => MaterialApp(
      home: Scaffold(
        body: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            ComposerChromeVisibility(
              visible: visible,
              child: const SizedBox(
                key: ValueKey('auxiliary-chrome'),
                width: 200,
                height: 48,
              ),
            ),
            const SizedBox(height: 56),
          ],
        ),
      ),
    );

void main() {
  testWidgets('slides and collapses auxiliary composer chrome', (tester) async {
    await tester.pumpWidget(_wrap(visible: true));

    final visibility = find.byType(ComposerChromeVisibility);
    expect(tester.getSize(visibility).height, 48);

    await tester.pumpWidget(_wrap(visible: false));
    await tester.pump(const Duration(milliseconds: 110));
    final midHeight = tester.getSize(visibility).height;
    expect(midHeight, greaterThan(0));
    expect(midHeight, lessThan(48));

    await tester.pumpAndSettle();
    expect(tester.getSize(visibility).height, 0);

    await tester.pumpWidget(_wrap(visible: true));
    await tester.pumpAndSettle();
    expect(tester.getSize(visibility).height, 48);
  });
}
