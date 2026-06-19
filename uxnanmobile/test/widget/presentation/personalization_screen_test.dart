import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
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

/// The library is rendered inside an [ExpansionTile] that starts
/// collapsed. Tests that need to read rows or tap theme items expand
/// the tile first via this helper.
Future<void> _expandThemes(WidgetTester tester) async {
  await tester.tap(find.byType(ExpansionTile));
  await tester.pumpAndSettle();
}

/// The screen now hosts a tall three-section layout: a 3-segment theme
/// mode picker + master switch + collapsible themes library + language
/// selector. Resize the view to a tall tablet viewport for the duration
/// of the test, then restore.
Future<void> _useTallViewport(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('renders a 3-segment theme picker, switch and language',
      (tester) async {
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    // Theme segmented control — only System / Light / Dark now.
    expect(find.text('System'), findsOneWidget);
    expect(find.text('Light'), findsOneWidget);
    expect(find.text('Dark'), findsOneWidget);
    expect(find.text('Custom'), findsNothing);
    // Master switch + collapsible library header are visible (the tile
    // starts collapsed — its rows are created lazily).
    expect(find.text('Use a custom theme'), findsOneWidget);
    expect(find.text('Custom themes'), findsOneWidget);
    // Flip the switch on + expand the tile so the two built-in rows
    // become reachable.
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    await _expandThemes(tester);
    expect(find.text('Midnight'), findsOneWidget);
    expect(find.text('Sandstone'), findsOneWidget);
    // Language section.
    expect(find.text('System default'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Español'), findsOneWidget);
  });

  testWidgets(
      'first-run picker lands on System with the custom-themes switch off',
      (tester) async {
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    final picker = tester.widget<SegmentedButton<ThemeModeOption>>(
      find.byType(SegmentedButton<ThemeModeOption>),
    );
    // System is the initial mode (no prior preference on disk).
    expect(picker.selected, contains(ThemeModeOption.system));
    // All three segments are enabled on first run — the master switch
    // (not the segments) gates the custom-theme mode.
    for (final segment in picker.segments) {
      expect(segment.enabled, isTrue);
    }
    final container = ProviderScope.containerOf(
      tester.element(find.byType(PersonalizationScreen)),
    );
    expect(container.read(useCustomThemeProvider), isFalse);
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

  testWidgets('flipping the switch on then tapping a built-in activates it',
      (tester) async {
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    // The rows are intentionally non-interactive while the switch is off
    // (per the design — the collapsible's enabled state follows the
    // switch). Flip the switch on first, expand the library (it starts
    // collapsed), then tap "Midnight".
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    await _expandThemes(tester);
    await tester.tap(find.text('Midnight'));
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(PersonalizationScreen)),
    );
    expect(container.read(useCustomThemeProvider), isTrue);
    expect(
        container.read(activeCustomThemeIdProvider), 'uxnan.builtin.midnight');
    expect(container.read(customThemeSettingProvider), isNotNull);
    expect(container.read(customThemeSettingProvider)!.id,
        'uxnan.builtin.midnight');
  });

  testWidgets('a pre-seeded active theme hydrates and shows the Active badge',
      (tester) async {
    final theme = CustomTheme.fromDualSchemes(
      id: 'aurora',
      name: 'Aurora',
      description: 'A vivid purple light/dark pair.',
      light: ColorScheme.fromSeed(
        seedColor: const Color(0xFF6750A4),
        brightness: Brightness.light,
      ),
      dark: ColorScheme.fromSeed(
        seedColor: const Color(0xFF6750A4),
        brightness: Brightness.dark,
      ),
    );
    SharedPreferences.setMockInitialValues({
      'uxnan.appearance.useCustomTheme': true,
      'uxnan.appearance.activeCustomThemeId': 'aurora',
      'uxnan.appearance.customThemes': '[${jsonEncodeForPrefs(theme)}]',
    });
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(PersonalizationScreen)),
    );
    // Wait for the hydrate to finish.
    await tester.pumpAndSettle();
    final active = container.read(customThemeSettingProvider);
    expect(active, isNotNull);
    expect(active!.id, 'aurora');
    // Expand the library (it starts collapsed) to read the row + badge.
    await _expandThemes(tester);
    expect(find.text('Aurora'), findsWidgets);
    expect(find.text('Active'), findsOneWidget);
  });

  testWidgets('the library expansion state persists across restarts',
      (tester) async {
    // First session: flip the master switch on and expand the library.
    SharedPreferences.setMockInitialValues({});
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    await _expandThemes(tester);
    expect(
        SharedPreferences.getInstance().then(
          (prefs) => prefs.getBool('uxnan.appearance.customThemesExpanded'),
        ),
        completion(isTrue));

    // Second session: re-mount the screen with the same prefs and confirm
    // the library opens expanded by default.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    // No tap on ExpansionTile this time — it must already be open.
    expect(find.text('Midnight'), findsOneWidget);
  });

  testWidgets(
      'deleting an authored theme does not crash when the row unmounts',
      (tester) async {
    final authored = CustomTheme.fromDualSchemes(
      id: 'autumn',
      name: 'Autumn',
      light: ColorScheme.fromSeed(
        seedColor: const Color(0xFF6750A4),
        brightness: Brightness.light,
      ),
      dark: ColorScheme.fromSeed(
        seedColor: const Color(0xFF6750A4),
        brightness: Brightness.dark,
      ),
    );
    SharedPreferences.setMockInitialValues({
      'uxnan.appearance.useCustomTheme': true,
      'uxnan.appearance.activeCustomThemeId': 'autumn',
      'uxnan.appearance.customThemes':
          '[${jsonEncodeForPrefs(authored)}]',
    });
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    await _expandThemes(tester);

    // Open the popup menu on the authored row + pick Delete.
    await tester.tap(find.byIcon(Icons.more_vert_rounded).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete').first);
    await tester.pumpAndSettle();
    // Confirm in the dialog — this triggers the unmount + cleanup path.
    await tester.tap(find.text('Delete').last);
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(PersonalizationScreen)),
    );
    // Library is now the built-ins only; the switch flipped off because
    // the deleted theme was active.
    expect(container.read(useCustomThemeProvider), isFalse);
    expect(container.read(activeCustomThemeIdProvider), isNull);
    expect(container.read(customThemeSettingProvider), isNull);
  });

  testWidgets(
      'tapping + New theme opens the seed+brightness picker dialog',
      (tester) async {
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    await _expandThemes(tester);

    await tester.tap(find.text('New theme'));
    await tester.pumpAndSettle();

    // Dialog body copy + both brightness segments visible.
    expect(
      find.text('Pick a seed color and the brightness the new theme should '
          'target.'),
      findsOneWidget,
    );
    expect(find.text('Light'), findsWidgets);
    expect(find.text('Dark'), findsWidgets);
    expect(find.text('Cancel'), findsOneWidget);
    expect(find.text('Apply'), findsOneWidget);
  });

  testWidgets(
      'library-level actions are visible without expanding the themes tile',
      (tester) async {
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    // The themes tile starts collapsed; the actions must STILL be reachable.
    expect(find.text('New theme'), findsOneWidget);
    expect(find.text('Import theme'), findsOneWidget);
    expect(find.text('Export all themes'), findsOneWidget);
    expect(find.text('Reset library'), findsOneWidget);
  });

  testWidgets(
      'creating a new dark theme applies it with ThemeMode.dark on save',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    await _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();

    // Open the new-theme dialog and pick the Dark segment.
    await tester.tap(find.text('New theme'));
    await tester.pumpAndSettle();
    // Sanity: the dialog body copy is the unique new affordance.
    expect(
      find.text('Pick a seed color and the brightness the new theme should '
          'target.'),
      findsOneWidget,
      reason: 'new-theme dialog must open',
    );
    // The dialog has its own Light/Dark segmented button. Scope the find
    // to the AlertDialog so it can't collide with the screen-level picker.
    await tester.tap(
      find.descendant(of: find.byType(AlertDialog), matching: find.text('Dark')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 500));

    // Editor opens with the Dark tab active; type a name + save.
    expect(find.byType(TextField), findsWidgets,
        reason: 'editor should expose the name/description fields');
    await tester.enterText(find.byType(TextField).first, 'Charcoal');
    await tester.pumpAndSettle();
    // The Save button sits below a tall role list — scroll until it comes
    // into view so the tap registers.
    final saveFinder = find.text('Save');
    await tester.scrollUntilVisible(saveFinder, 200,
        scrollable: find.byType(Scrollable).first);
    expect(saveFinder, findsOneWidget,
        reason: 'editor should have a Save button');
    await tester.tap(saveFinder);
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(PersonalizationScreen)),
    );
    // New theme auto-activates, master switch on, themeMode is dark.
    expect(container.read(useCustomThemeProvider), isTrue);
    expect(container.read(activeCustomThemeIdProvider), isNotNull);
    expect(container.read(themeModeSettingProvider), ThemeMode.dark);
    final active = container.read(customThemeSettingProvider);
    expect(active, isNotNull);
    expect(active!.name, 'Charcoal');
  });
}

/// Inline JSON encoder used to round-trip a [CustomTheme] into the
/// `uxnan.appearance.customThemes` mock prefs value. We can't import
/// `dart:convert` here without polluting the test surface.
String jsonEncodeForPrefs(Object value) {
  // Defer to the real encoder via the value object's own helpers.
  if (value is CustomTheme) return value.toJsonString();
  throw ArgumentError('unsupported test value: $value');
}
