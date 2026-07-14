import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/widgets/message_scroll_rail.dart';

void main() {
  Widget host(Widget child) => MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(width: 300, height: 400, child: child),
          ),
        ),
      );

  // Advances past the auto-hide delay and settles the fade so no timers or
  // animations leak between tests.
  Future<void> flush(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
  }

  testWidgets('renders nothing below minItems', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          // Loose constraints (no forced size) so a shrink collapses to zero.
          body: Center(
            child: MessageScrollRail(
              items: const [MessageScrollRailItem(preview: 'only one')],
              onSelected: (_) {},
            ),
          ),
        ),
      ),
    );

    expect(tester.getSize(find.byType(MessageScrollRail)), Size.zero);
  });

  testWidgets('tapping the edge strip commits the nearest anchor',
      (tester) async {
    int? selected;
    final items = List.generate(
      5,
      (i) => MessageScrollRailItem(preview: 'message $i'),
    );

    await tester.pumpWidget(
      host(
        MessageScrollRail(
          items: items,
          haptics: false,
          onSelected: (i) => selected = i,
        ),
      ),
    );

    // Tap near the top of the right-edge strip → the first anchor.
    final rect = tester.getRect(find.byType(MessageScrollRail));
    await tester.tapAt(Offset(rect.right - 16, rect.top + 4));
    await tester.pump();

    expect(selected, 0);
    await flush(tester);
  });

  testWidgets(
      'dragging down the strip scrubs, previews and commits the last '
      'anchor', (tester) async {
    int? selected;
    final active = <int?>[];
    final items = List.generate(
      4,
      (i) => MessageScrollRailItem(
        preview: 'message number $i',
        secondaryPreview: 'reply $i',
      ),
    );

    await tester.pumpWidget(
      host(
        MessageScrollRail(
          items: items,
          haptics: false,
          onSelected: (i) => selected = i,
          onActiveChanged: active.add,
        ),
      ),
    );

    final rect = tester.getRect(find.byType(MessageScrollRail));
    final x = rect.right - 16;
    final gesture = await tester.startGesture(Offset(x, rect.top + 40));
    await tester.pump();
    await gesture.moveBy(const Offset(0, 40)); // cross the touch slop
    await tester.pump();
    await gesture.moveTo(Offset(x, rect.bottom - 4)); // scrub to the last tick
    await tester.pump();

    // The active anchor's preview (primary + secondary) is shown while
    // scrubbing.
    expect(active, isNotEmpty, reason: 'active=$active');
    expect(active.last, 3, reason: 'active=$active');
    expect(find.text('message number 3'), findsOneWidget);
    expect(find.text('reply 3'), findsOneWidget);

    await gesture.up();
    await tester.pump();

    expect(selected, 3, reason: 'active=$active selected=$selected');
    await flush(tester);
  });
}
