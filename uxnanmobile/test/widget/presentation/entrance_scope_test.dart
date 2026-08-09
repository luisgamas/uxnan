import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/widgets/ne_enter_transition.dart';
import 'package:uxnan/presentation/widgets/ne_entrance_scope.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// A staggered list is easy to write and easy to get wrong in exactly one way:
/// a lazy `SliverList` builds row 30 when you scroll to it, so a naive
/// `index × step` delay makes rows animate in under your thumb, forever. What
/// should animate is the list *arriving*, once.
Future<void> main() async {
  Widget host({int rows = 40, bool withScope = true}) {
    final list = CustomScrollView(
      slivers: [
        SliverList.builder(
          itemCount: rows,
          itemBuilder: (context, index) => NeEntranceRow(
            index: index,
            child: SizedBox(height: 80, child: Text('row $index')),
          ),
        ),
      ],
    );
    return MaterialApp(
      home: Scaffold(
        body: withScope ? NeEntranceScope(child: list) : list,
      ),
    );
  }

  bool animated(WidgetTester tester, String rowText) {
    return find
        .ancestor(
          of: find.text(rowText),
          matching: find.byType(NeEnterTransition),
        )
        .evaluate()
        .isNotEmpty;
  }

  testWidgets('the first screenful rises into place', (tester) async {
    await tester.pumpWidget(host());
    expect(animated(tester, 'row 0'), isTrue);
    expect(animated(tester, 'row 1'), isTrue);
    await tester.pumpAndSettle();
  });

  testWidgets('rows reached by scrolling do not', (tester) async {
    await tester.pumpWidget(host());
    await tester.pumpAndSettle();

    // Well past the entrance window, and past anything built at startup.
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -2000));
    await tester.pumpAndSettle();

    final visible = find
        .byType(Text)
        .evaluate()
        .map((e) => (e.widget as Text).data!)
        .toList();
    expect(visible, isNotEmpty);
    for (final row in visible) {
      expect(
        animated(tester, row),
        isFalse,
        reason: "$row animated in under the reader's thumb",
      );
    }
  });

  testWidgets('a row keeps its state through and after the entrance',
      (tester) async {
    // The bug this pins: the entrance window shuts after the first frame, so
    // asking per build made the SECOND build return the bare child — changing
    // the subtree's shape, which unmounts the row's element and takes every
    // piece of State inside it with it. In the app that showed up as a
    // revealed address quietly re-hiding itself.
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: NeEntranceScope(child: _CounterList())),
      ),
    );

    await tester.tap(find.text('row 0: 0'));
    await tester.pump();
    expect(find.text('row 0: 1'), findsOneWidget);

    // Past the window, and past the end of the entrance itself.
    await tester.pumpAndSettle();
    expect(
      find.text('row 0: 1'),
      findsOneWidget,
      reason: 'the row was rebuilt from scratch and lost its count',
    );

    await tester.tap(find.text('row 0: 1'));
    await tester.pump();
    expect(find.text('row 0: 2'), findsOneWidget);
  });

  testWidgets('without a scope nothing animates at all', (tester) async {
    await tester.pumpWidget(host(withScope: false));
    expect(find.byType(NeEnterTransition), findsNothing);
    await tester.pumpAndSettle();
  });

  testWidgets('every NeScaffold is a scope, with nothing to wire up',
      (tester) async {
    // Screens do not wrap themselves: a row inside any NeScaffold can ask for
    // an entrance and get one. If this stops being true, every list in the app
    // silently stops animating and nothing else fails.
    await tester.pumpWidget(
      MaterialApp(
        home: NeScaffold(
          title: 'Anything',
          slivers: [
            SliverList.builder(
              itemCount: 5,
              itemBuilder: (context, index) => NeEntranceRow(
                index: index,
                child: SizedBox(height: 80, child: Text('row $index')),
              ),
            ),
          ],
        ),
      ),
    );

    expect(find.byType(NeEnterTransition), findsWidgets);
    await tester.pumpAndSettle();
  });

  testWidgets('reduced motion is honoured', (tester) async {
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: host(),
      ),
    );
    expect(find.byType(NeEnterTransition), findsNothing);
    await tester.pumpAndSettle();
  });
}

/// A list whose rows hold state, so losing it is visible.
class _CounterList extends StatelessWidget {
  const _CounterList();

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      slivers: [
        SliverList.builder(
          itemCount: 5,
          itemBuilder: (context, index) => NeEntranceRow(
            index: index,
            child: _Counter(index: index),
          ),
        ),
      ],
    );
  }
}

class _Counter extends StatefulWidget {
  const _Counter({required this.index});

  final int index;

  @override
  State<_Counter> createState() => _CounterState();
}

class _CounterState extends State<_Counter> {
  int _taps = 0;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() => _taps++),
      child: SizedBox(
        height: 80,
        child: Text('row ${widget.index}: $_taps'),
      ),
    );
  }
}
