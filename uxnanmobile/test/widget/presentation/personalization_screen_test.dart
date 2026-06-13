import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/infrastructure/storage/appearance_preferences_store.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/settings/personalization_screen.dart';

Widget _wrap() {
  return const ProviderScope(
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: PersonalizationScreen(),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('renders theme, accent and language options', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    // Theme segmented control.
    expect(find.text('System'), findsOneWidget);
    expect(find.text('Light'), findsOneWidget);
    expect(find.text('Dark'), findsOneWidget);
    // Accent + language sections.
    expect(find.text('Accent color'), findsOneWidget);
    expect(find.text('System default'), findsOneWidget);
    // Language list is derived from supportedLocales (auto-detects new ones).
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Español'), findsOneWidget);
  });

  testWidgets('selecting a language persists the override', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Español'));
    await tester.pumpAndSettle();

    final stored = await AppearancePreferencesStore(
      preferences: SharedPreferences.getInstance(),
    ).readLocaleTag();
    expect(stored, 'es');
  });
}
