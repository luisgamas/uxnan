import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// `NeScaffold.constrainContent` — content stops stretching on wide windows,
/// and provably does NOTHING on a phone.
void main() {
  const contentKey = Key('content');

  Future<void> pumpAt(
    WidgetTester tester,
    double width, {
    bool constrain = true,
  }) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: NeScaffold(
          title: 'Uxnan',
          constrainContent: constrain,
          slivers: const [
            SliverToBoxAdapter(
              child: SizedBox(key: contentKey, height: 120),
            ),
          ],
        ),
      ),
    );
  }

  testWidgets('compact content spans the full width (no-op)', (tester) async {
    await pumpAt(tester, 390);

    expect(tester.getSize(find.byKey(contentKey)).width, 390);
  });

  testWidgets('medium content still spans the full width', (tester) async {
    await pumpAt(tester, 800);

    expect(tester.getSize(find.byKey(contentKey)).width, 800);
  });

  testWidgets('expanded clamps content to 840 dp', (tester) async {
    await pumpAt(tester, 1000);

    expect(tester.getSize(find.byKey(contentKey)).width, 840);
  });

  testWidgets('large clamps content to 1040 dp', (tester) async {
    await pumpAt(tester, 1280);

    expect(tester.getSize(find.byKey(contentKey)).width, 1040);
  });

  testWidgets('the top bar keeps the full width while content is clamped',
      (tester) async {
    await pumpAt(tester, 1280);

    // Chrome spans the row; only the content column is measured. A centered
    // bar would leave the back button floating in the middle of the window.
    expect(tester.getSize(find.byType(NeTopBar)).width, 1280);
  });

  testWidgets('constrainContent: false opts a screen out', (tester) async {
    await pumpAt(tester, 1280, constrain: false);

    expect(tester.getSize(find.byKey(contentKey)).width, 1280);
  });
}
