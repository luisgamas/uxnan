import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/widgets/ne_scroll_aware_fab.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// A FAB that hides while you scroll has to come back on its own, and has to
/// stop taking taps while it is gone. Both are easy to get subtly wrong: an
/// `Opacity(0)` button still swallows the row underneath it, and a hide keyed
/// to a timer instead of the scroll ending returns at the wrong moment.
Future<void> main() async {
  Widget host({required bool hideFabOnScroll, VoidCallback? onFab}) {
    return MaterialApp(
      home: NeScaffold(
        title: 'Threads',
        hideFabOnScroll: hideFabOnScroll,
        floatingActionButton: FloatingActionButton(
          onPressed: onFab ?? () {},
          child: const Icon(Icons.add),
        ),
        slivers: [
          SliverList.builder(
            itemCount: 60,
            itemBuilder: (_, i) => SizedBox(height: 60, child: Text('row $i')),
          ),
        ],
      ),
    );
  }

  double opacityOfFab(WidgetTester tester) {
    return tester
        .widget<Opacity>(
          find.descendant(
            of: find.byType(NeScrollAwareFab),
            matching: find.byType(Opacity),
          ),
        )
        .opacity;
  }

  testWidgets('hides while the list moves and returns when it settles',
      (tester) async {
    await tester.pumpWidget(host(hideFabOnScroll: true));
    expect(opacityOfFab(tester), 1);

    // A drag that is held: the scroll has started and has not ended.
    final gesture = await tester.startGesture(const Offset(200, 400));
    await gesture.moveBy(const Offset(0, -200));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(
      opacityOfFab(tester),
      lessThan(0.5),
      reason: 'the button should be getting out of the way',
    );

    await gesture.up();
    await tester.pumpAndSettle();
    expect(opacityOfFab(tester), 1, reason: 'and come back once it settles');
  });

  testWidgets('takes no taps while it is hidden', (tester) async {
    var taps = 0;
    await tester.pumpWidget(host(hideFabOnScroll: true, onFab: () => taps++));

    final gesture = await tester.startGesture(const Offset(200, 400));
    await gesture.moveBy(const Offset(0, -200));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    await tester.tap(find.byType(FloatingActionButton), warnIfMissed: false);
    await tester.pump();
    expect(taps, 0);

    await gesture.up();
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pump();
    expect(taps, 1, reason: 'and takes them again once it is back');
  });

  testWidgets('a scroll affordance FAB is left alone', (tester) async {
    await tester.pumpWidget(host(hideFabOnScroll: false));

    // Not opted in: the button is passed straight through, so there is no
    // wrapper to hide it. The conversation history's back-to-top depends on
    // this — it exists for the moment the other mode would remove it.
    expect(find.byType(NeScrollAwareFab), findsNothing);

    final gesture = await tester.startGesture(const Offset(200, 400));
    await gesture.moveBy(const Offset(0, -200));
    await tester.pump();
    expect(find.byType(FloatingActionButton), findsOneWidget);
    await gesture.up();
    await tester.pumpAndSettle();
  });
}
