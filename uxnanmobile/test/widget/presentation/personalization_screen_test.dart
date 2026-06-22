import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/infrastructure/storage/appearance_preferences_store.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/settings/personalization_screen.dart';
import 'package:uxnan/presentation/screens/settings/theme_manager_screen.dart';

Widget _wrap() {
  return const ProviderScope(
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: PersonalizationScreen(),
    ),
  );
}

/// The screen hosts a 3-segment theme mode picker + a custom-theme card +
/// language selector. Use a tall viewport so every section is laid out.
void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

ProviderContainer _container(WidgetTester tester) => ProviderScope.containerOf(
      tester.element(find.byType(PersonalizationScreen)),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('renders the theme picker, custom-theme card and language',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    // Theme segmented control — only System / Light / Dark.
    expect(find.text('System'), findsOneWidget);
    expect(find.text('Light'), findsOneWidget);
    expect(find.text('Dark'), findsOneWidget);
    expect(find.text('Custom'), findsNothing);
    // Custom-theme card: master switch + manage entry (the library grid now
    // lives in its own screen, not inline here).
    expect(find.text('Use a custom theme'), findsOneWidget);
    expect(find.text('Custom themes'), findsOneWidget);
    expect(find.text('Midnight'), findsNothing);
    // Language section.
    expect(find.text('System default'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Español'), findsOneWidget);
  });

  testWidgets(
      'first-run picker lands on System with the custom-themes switch off',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    final picker = tester.widget<SegmentedButton<ThemeModeOption>>(
      find.byType(SegmentedButton<ThemeModeOption>),
    );
    expect(picker.selected, contains(ThemeModeOption.system));
    // Enabled on first run (brand baseline) — the segments gate nothing yet.
    for (final segment in picker.segments) {
      expect(segment.enabled, isTrue);
    }
    expect(_container(tester).read(useCustomThemeProvider), isFalse);
  });

  testWidgets('selecting a language persists the override', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Español'));
    await tester.pumpAndSettle();

    final stored = await AppearancePreferencesStore(
      preferences: SharedPreferences.getInstance(),
    ).readLocaleTag();
    expect(stored, 'es');
  });

  testWidgets('flipping the master switch on activates the first library theme',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();

    final container = _container(tester);
    expect(container.read(useCustomThemeProvider), isTrue);
    // The first built-in (Midnight) becomes active so the change is visible.
    expect(
        container.read(activeCustomThemeIdProvider), 'uxnan.builtin.midnight');
    expect(container.read(customThemeSettingProvider)?.id,
        'uxnan.builtin.midnight');
  });

  testWidgets('a pre-seeded active theme shows its name on the card',
      (tester) async {
    final theme = CustomTheme.fromDualSchemes(
      id: 'aurora',
      name: 'Aurora',
      light: ColorScheme.fromSeed(seedColor: const Color(0xFF6750A4)),
      dark: ColorScheme.fromSeed(
        seedColor: const Color(0xFF6750A4),
        brightness: Brightness.dark,
      ),
    );
    SharedPreferences.setMockInitialValues({
      'uxnan.appearance.useCustomTheme': true,
      'uxnan.appearance.activeCustomThemeId': 'aurora',
      'uxnan.appearance.customThemes': '[${theme.toJsonString()}]',
    });
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    final active = _container(tester).read(customThemeSettingProvider);
    expect(active?.id, 'aurora');
    // The active theme name shows as the card subtitle.
    expect(find.text('Aurora'), findsOneWidget);
  });

  testWidgets('tapping the custom-themes entry opens the theme manager',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Custom themes'));
    await tester.pumpAndSettle();

    expect(find.byType(ThemeManagerScreen), findsOneWidget);
    expect(find.text('Themes'), findsOneWidget);
  });
}
