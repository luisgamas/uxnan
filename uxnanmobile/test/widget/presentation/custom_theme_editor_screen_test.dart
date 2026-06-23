import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/settings/custom_theme_editor_screen.dart';

Widget _wrap(CustomTheme initial) {
  return ProviderScope(
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: CustomThemeEditorScreen(initial: initial),
    ),
  );
}

void _useTallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

CustomTheme _singleLight() => CustomTheme.single(
      id: 'single',
      name: 'Solo',
      brightness: Brightness.light,
      scheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1B6EF3)),
    );

CustomTheme _dual() => CustomTheme.fromDualSchemes(
      id: 'dual',
      name: 'Pair',
      light: ColorScheme.fromSeed(seedColor: const Color(0xFF1B6EF3)),
      dark: ColorScheme.fromSeed(
        seedColor: const Color(0xFF1B6EF3),
        brightness: Brightness.dark,
      ),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
      'a single theme shows the add-side affordance, no brightness tabs',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(_singleLight()));
    await tester.pumpAndSettle();

    expect(find.byType(SegmentedButton<Brightness>), findsNothing);
    expect(find.text('Add a dark side'), findsOneWidget);
  });

  testWidgets('adding the other side promotes the theme to dual (tabs appear)',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(_singleLight()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add a dark side'));
    await tester.pumpAndSettle();

    expect(find.byType(SegmentedButton<Brightness>), findsOneWidget);
    expect(find.text('Add a dark side'), findsNothing);
  });

  testWidgets('a dual theme shows the Light/Dark brightness tabs',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(_dual()));
    await tester.pumpAndSettle();

    expect(find.byType(SegmentedButton<Brightness>), findsOneWidget);
    expect(find.text('Add a dark side'), findsNothing);
    expect(find.text('Add a light side'), findsNothing);
  });

  testWidgets('the app bar exposes Save + Export and an overflow, not Import',
      (tester) async {
    _useTallViewport(tester);
    await tester.pumpWidget(_wrap(_dual()));
    await tester.pumpAndSettle();

    // Save (check) is the primary action; Export sits next to it; Import is
    // gone (it belongs to the library manager, not the per-theme editor).
    expect(find.byIcon(Icons.check_rounded), findsOneWidget);
    expect(find.byIcon(Icons.upload_file_outlined), findsOneWidget);
    expect(find.byIcon(Icons.download_outlined), findsNothing);

    // Reset / derive moved into the overflow menu.
    await tester.tap(find.byIcon(Icons.more_vert_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Reset brightness'), findsOneWidget);
    expect(find.text('Derive from seed'), findsOneWidget);
  });
}
