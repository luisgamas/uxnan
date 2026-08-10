import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_circular_button.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';
import '../../support/ux_icon_finder.dart';

void main() {
  testWidgets('uses the shared neutral scroll-shortcut treatment',
      (tester) async {
    const scheme = ColorScheme.light();
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(colorScheme: scheme),
        home: Scaffold(
          body: Center(
            child: NeCircularButton(
              icon: UxIcons.keyboardArrowDown,
              tooltip: 'Scroll',
              onTap: () {},
            ),
          ),
        ),
      ),
    );

    expect(
      tester.getSize(find.byType(NeCircularButton)),
      const Size.square(UxnanSize.floatingScrollShortcut),
    );
    final material = tester.widget<Material>(
      find.descendant(
        of: find.byType(NeCircularButton),
        matching: find.byType(Material),
      ),
    );
    expect(material.color, scheme.surfaceContainerHighest);
    expect(material.shape, isA<CircleBorder>());
    expect(
      tester.widget<UxIcon>(findUxIcon(UxIcons.keyboardArrowDown)).color,
      scheme.onSurfaceVariant,
    );
  });
}
