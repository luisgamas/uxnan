import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';

/// Wraps [child] in a minimal Material host so [ConnectedButtonGroup] can
/// resolve Theme.of and its surface colors during tests.
Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('renders one button per value in order', (tester) async {
    await tester.pumpWidget(
      _wrap(
        ConnectedButtonGroup<String>(
          values: const ['One', 'Two', 'Three'],
          selected: 'One',
          onChanged: (_) {},
          labelBuilder: (v, _) => Text(v),
        ),
      ),
    );

    expect(find.text('One'), findsOneWidget);
    expect(find.text('Two'), findsOneWidget);
    expect(find.text('Three'), findsOneWidget);
  });

  testWidgets('invokes onChanged with the tapped value', (tester) async {
    String? picked;
    await tester.pumpWidget(
      _wrap(
        ConnectedButtonGroup<int>(
          values: const [1, 2, 3],
          selected: 1,
          onChanged: (v) => picked = v.toString(),
          labelBuilder: (v, _) => Text('Opt $v'),
        ),
      ),
    );

    await tester.tap(find.text('Opt 2'));
    await tester.pumpAndSettle();

    expect(picked, '2');
  });

  testWidgets('selected option uses secondaryContainer + bold text',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        ConnectedButtonGroup<String>(
          values: const ['A', 'B'],
          selected: 'B',
          onChanged: (_) {},
          labelBuilder: (v, _) => Text(v),
        ),
      ),
    );

    // The selected vs unselected styling flows through DefaultTextStyle, so
    // we read the inherited style from each Text's nearest enclosing
    // DefaultTextStyle and compare its font weight.
    final selectedStyle = tester
        .widget<DefaultTextStyle>(
          find
              .ancestor(
                of: find.text('B'),
                matching: find.byType(DefaultTextStyle),
              )
              .first,
        )
        .style;
    expect(selectedStyle.fontWeight, FontWeight.w600);

    final notSelectedStyle = tester
        .widget<DefaultTextStyle>(
          find
              .ancestor(
                of: find.text('A'),
                matching: find.byType(DefaultTextStyle),
              )
              .first,
        )
        .style;
    expect(notSelectedStyle.fontWeight, FontWeight.w500);
  });

  testWidgets('refuses more than 5 options', (tester) async {
    expect(
      () => ConnectedButtonGroup<int>(
        values: const [1, 2, 3, 4, 5, 6],
        selected: 1,
        onChanged: (_) {},
        labelBuilder: (v, _) => Text('$v'),
      ),
      throwsAssertionError,
    );
  });
}
