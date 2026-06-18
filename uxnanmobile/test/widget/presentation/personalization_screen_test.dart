import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/accent_color.dart';
import 'package:uxnan/infrastructure/storage/appearance_preferences_store.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
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

/// The screen now hosts three sections (theme, accent, language). The accent
/// picker is the 7-swatch list, so a phone-sized test viewport is not tall
/// enough to render every section at once. Resize the test view to a tall
/// tablet viewport for the duration of the test, then restore it.
Future<void> _useTallViewport(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('renders theme, accent and language options', (tester) async {
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    // Theme segmented control.
    expect(find.text('System'), findsOneWidget);
    expect(find.text('Light'), findsOneWidget);
    expect(find.text('Dark'), findsOneWidget);
    // Accent section header is still present.
    expect(find.text('Accent color'), findsOneWidget);
    // Every swatch label is rendered, in the palette order.
    expect(find.text('Blue'), findsOneWidget);
    expect(find.text('Purple'), findsOneWidget);
    expect(find.text('Pink'), findsOneWidget);
    expect(find.text('Red'), findsOneWidget);
    expect(find.text('Orange'), findsOneWidget);
    expect(find.text('Green'), findsOneWidget);
    expect(find.text('Teal'), findsOneWidget);
    // The "Coming soon" placeholder is gone.
    expect(find.text('Coming soon'), findsNothing);
    // Language section.
    expect(find.text('System default'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Español'), findsOneWidget);
  });

  testWidgets('the default accent (blue) is marked as selected on first run',
      (tester) async {
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    // A check icon is shown for the selected row only — on first run the
    // brand blue is the only one.
    final checkIcons = find.byIcon(Icons.check_rounded);
    expect(checkIcons, findsOneWidget);
  });

  testWidgets('tapping a swatch updates the active accent and persists it',
      (tester) async {
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Purple'));
    await tester.pumpAndSettle();

    // Provider now resolves to purple.
    final container = ProviderScope.containerOf(
      tester.element(find.byType(PersonalizationScreen)),
    );
    expect(container.read(accentSettingProvider), AccentPalette.purple);

    // And the pick survives a reload.
    final stored = await AppearancePreferencesStore(
      preferences: SharedPreferences.getInstance(),
    ).readAccentId();
    expect(stored, 'purple');
  });

  testWidgets('selecting a language persists the override', (tester) async {
    await _useTallViewport(tester);
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
