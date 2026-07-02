import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/settings/theme_manager_screen.dart';

Widget _wrap() {
  return const ProviderScope(
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: ThemeManagerScreen(),
    ),
  );
}

void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

ProviderContainer _container(WidgetTester tester) => ProviderScope.containerOf(
      tester.element(find.byType(ThemeManagerScreen)),
    );

CustomTheme _authored(String id, String name) => CustomTheme.fromDualSchemes(
      id: id,
      name: name,
      light: ColorScheme.fromSeed(seedColor: const Color(0xFF6750A4)),
      dark: ColorScheme.fromSeed(
        seedColor: const Color(0xFF6750A4),
        brightness: Brightness.dark,
      ),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('renders a preview card per library theme', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    // The two built-in themes seed the library on a fresh install.
    expect(find.text('Midnight'), findsOneWidget);
    expect(find.text('Sandstone'), findsOneWidget);
    expect(find.text('Themes'), findsOneWidget); // app-bar title
  });

  testWidgets('tapping a card activates that theme', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Midnight'));
    await tester.pumpAndSettle();

    final container = _container(tester);
    expect(container.read(useCustomThemeProvider), isTrue);
    expect(
      container.read(activeCustomThemeIdProvider),
      'uxnan.builtin.midnight',
    );
  });

  testWidgets('long-pressing a card enters multi-select mode', (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.longPress(find.text('Midnight'));
    await tester.pumpAndSettle();

    // The app bar swaps to the selection title with a live count.
    expect(find.text('1 selected'), findsOneWidget);
  });

  testWidgets('importing a multi-theme JSON adds all and persists on remount',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    final json = '[${_authored('imp-a', 'ImpA').toJsonString()},'
        '${_authored('imp-b', 'ImpB').toJsonString()}]';

    await tester.tap(find.byIcon(Icons.file_download_outlined));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), json);
    await tester.pumpAndSettle(); // let the Import button enable
    final importBtn = find.widgetWithText(FilledButton, 'Import theme');
    await tester.ensureVisible(importBtn);
    await tester.pumpAndSettle();
    await tester.tap(importBtn);
    await tester.pumpAndSettle();

    expect(find.text('ImpA'), findsOneWidget);
    expect(find.text('ImpB'), findsOneWidget);

    // Simulate an app restart: a fresh ProviderScope rehydrates from the same
    // (persisted) SharedPreferences.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    expect(find.text('ImpA'), findsOneWidget);
    expect(find.text('ImpB'), findsOneWidget);
  });

  testWidgets('a JSON with duplicate ids imports each as a distinct theme',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    final dup = _authored('dup', 'Dup');
    final json = '[${dup.toJsonString()},${dup.toJsonString()}]';

    await tester.tap(find.byIcon(Icons.file_download_outlined));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), json);
    await tester.pumpAndSettle(); // let the Import button enable
    final importBtn = find.widgetWithText(FilledButton, 'Import theme');
    await tester.ensureVisible(importBtn);
    await tester.pumpAndSettle();
    await tester.tap(importBtn);
    await tester.pumpAndSettle();

    // Both kept (the second got a fresh id) — two cards named 'Dup'.
    expect(find.text('Dup'), findsNWidgets(2));
  });

  testWidgets('multi-select delete removes the selected authored theme',
      (tester) async {
    final autumn = _authored('autumn', 'Autumn');
    SharedPreferences.setMockInitialValues({
      'uxnan.appearance.useCustomTheme': true,
      'uxnan.appearance.activeCustomThemeId': 'autumn',
      'uxnan.appearance.customThemes': '[${autumn.toJsonString()}]',
    });
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    expect(find.text('Autumn'), findsOneWidget);

    // Long-press to select, then delete via the selection app bar.
    await tester.longPress(find.text('Autumn'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.delete_outline_rounded));
    await tester.pumpAndSettle();
    // Confirm in the dialog.
    expect(find.text('Delete selected themes?'), findsOneWidget);
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    expect(find.text('Autumn'), findsNothing);
    final container = _container(tester);
    expect(container.read(activeCustomThemeIdProvider), isNull);
    expect(container.read(useCustomThemeProvider), isFalse);
  });
}
