import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_loading_indicator/loading_indicator.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';

Widget _app({required Widget child, bool reducedMotion = false}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(disableAnimations: reducedMotion),
      child: Scaffold(body: Center(child: child)),
    ),
  );
}

void main() {
  testWidgets('uses the Material 3 expressive indicator at the requested size',
      (tester) async {
    const color = Color(0xFF6750A4);
    await tester.pumpWidget(
      _app(
        child: const PolygonLoader(
          size: 28,
          color: color,
          semanticsLabel: 'Loading workspace',
        ),
      ),
    );

    expect(find.byType(LoadingIndicator), findsOneWidget);
    expect(tester.getSize(find.byType(PolygonLoader)), const Size.square(28));
    expect(find.bySemanticsLabel('Loading workspace'), findsOneWidget);
    expect(
      tester
          .widget<LoadingIndicator>(find.byType(LoadingIndicator))
          .activeIndicatorColor,
      color,
    );
  });

  testWidgets('freezes decorative morphing when reduced motion is requested',
      (tester) async {
    await tester.pumpWidget(
      _app(
        reducedMotion: true,
        child: const PolygonLoader(),
      ),
    );

    final tickerMode = tester.widget<TickerMode>(find.byType(TickerMode).last);
    expect(tickerMode.enabled, isFalse);
    expect(find.byType(LoadingIndicator), findsOneWidget);
  });
}
