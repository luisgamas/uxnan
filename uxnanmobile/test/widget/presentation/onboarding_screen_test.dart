import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_screen.dart';

void main() {
  testWidgets('navigates through the onboarding pages to the pair CTA',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: OnboardingScreen(),
      ),
    );

    // The floating-agent animation repeats forever, so advance pages with a
    // fixed pump rather than pumpAndSettle (which would never settle).
    Future<void> turnPage(Finder button) async {
      await tester.tap(button);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    }

    // Page 1 — Welcome.
    expect(find.text('Control your agents from anywhere'), findsOneWidget);

    // → Page 2 — Features.
    await turnPage(find.text('Next'));
    expect(find.text('Built for the way you work'), findsOneWidget);

    // → Page 3 — Install (shows the bridge command).
    await turnPage(find.text('Next'));
    expect(find.text('npx uxnan-bridge'), findsOneWidget);

    // → Page 4 — Pair (the scan CTA replaces "Next").
    await turnPage(find.text('Next'));
    expect(find.text('Scan QR code'), findsOneWidget);

    // Back returns to the install page.
    await turnPage(find.text('Back'));
    expect(find.text('npx uxnan-bridge'), findsOneWidget);
  });
}
