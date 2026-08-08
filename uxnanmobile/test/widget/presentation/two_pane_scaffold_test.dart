import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/shell/app_shell_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// [TwoPaneScaffold] at real window widths.
///
/// The phone case is the important one: this widget is about to sit under every
/// screen, and it must be a pass-through there — not "a Row with one child",
/// which would still perturb layout.
void main() {
  const paneKey = Key('pane');
  const detailKey = Key('detail');

  Future<void> pumpAt(WidgetTester tester, double width, {Widget? pane}) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: TwoPaneScaffold(
          pane: pane,
          detail: const ColoredBox(key: detailKey, color: Color(0xFF101010)),
        ),
      ),
    );
  }

  const pane = ColoredBox(key: paneKey, color: Color(0xFF202020));

  testWidgets('compact shows only the detail, with no pane in the tree',
      (tester) async {
    await pumpAt(tester, 390, pane: pane);

    expect(find.byKey(detailKey), findsOneWidget);
    expect(find.byKey(paneKey), findsNothing);
    // A pass-through, not a one-child Row: no divider is laid out either.
    expect(find.byType(VerticalDivider), findsNothing);
  });

  testWidgets('medium still shows only the detail (the pane starts at 840)',
      (tester) async {
    await pumpAt(tester, 800, pane: pane);

    expect(find.byKey(paneKey), findsNothing);
  });

  testWidgets('expanded lays the pane beside the detail at 320 dp',
      (tester) async {
    await pumpAt(tester, 1000, pane: pane);

    expect(find.byKey(paneKey), findsOneWidget);
    expect(find.byKey(detailKey), findsOneWidget);
    expect(find.byType(VerticalDivider), findsOneWidget);

    expect(tester.getSize(find.byKey(paneKey)).width, UxnanSize.sidePane);
    // The detail takes the rest, minus the 1 dp seam.
    expect(
      tester.getSize(find.byKey(detailKey)).width,
      1000 - UxnanSize.sidePane - 1,
    );
  });

  testWidgets('extra-large widens the pane', (tester) async {
    await pumpAt(tester, 1700, pane: pane);

    expect(
      tester.getSize(find.byKey(paneKey)).width,
      UxnanSize.sidePaneWide,
    );
  });

  testWidgets('paneWidth overrides the breakpoint width', (tester) async {
    tester.view.physicalSize = const Size(1000, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      const MaterialApp(
        home: TwoPaneScaffold(
          pane: pane,
          paneWidth: 260,
          detail: ColoredBox(key: detailKey, color: Color(0xFF101010)),
        ),
      ),
    );

    expect(tester.getSize(find.byKey(paneKey)).width, 260);
  });

  testWidgets('a null pane is a pass-through at every width', (tester) async {
    await pumpAt(tester, 1700);

    expect(find.byKey(detailKey), findsOneWidget);
    expect(find.byType(VerticalDivider), findsNothing);
    expect(tester.getSize(find.byKey(detailKey)).width, 1700);
  });

  testWidgets('nested splits measure their own box, not the window',
      (tester) async {
    // A 1000 dp window with a 320 dp shell pane leaves ~680 dp of content —
    // too narrow for a second split. Measuring MediaQuery instead of the
    // constraints is what would wrongly nest a third column here.
    tester.view.physicalSize = const Size(1000, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      const MaterialApp(
        home: TwoPaneScaffold(
          pane: ColoredBox(color: Color(0xFF202020)),
          detail: TwoPaneScaffold(
            pane: ColoredBox(key: paneKey, color: Color(0xFF303030)),
            detail: ColoredBox(key: detailKey, color: Color(0xFF101010)),
          ),
        ),
      ),
    );

    expect(find.byKey(paneKey), findsNothing);
    expect(find.byKey(detailKey), findsOneWidget);
  });
}
