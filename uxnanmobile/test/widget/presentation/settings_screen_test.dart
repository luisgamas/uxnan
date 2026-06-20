import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/enums/context_indicator_mode.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';
import 'package:uxnan/infrastructure/storage/conversation_preferences_store.dart';
import 'package:uxnan/infrastructure/storage/notification_preferences_store.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/screens/settings/settings_screen.dart';

Widget _wrap() {
  return ProviderScope(
    overrides: [
      // A real store over mocked SharedPreferences (set up in setUp) so the
      // controller's persistence path runs without touching the platform.
      notificationPreferencesStoreProvider.overrideWithValue(
        NotificationPreferencesStore(
          preferences: SharedPreferences.getInstance(),
        ),
      ),
      // No PC connected → the toggle persists locally, skips the bridge push.
      connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
    ],
    child: const MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: SettingsScreen(),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('renders both notification toggles, on by default', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Replies'), findsOneWidget);
    expect(find.text('Errors'), findsOneWidget);
    expect(
      tester.widgetList<Switch>(find.byType(Switch)).every((s) => s.value),
      isTrue,
    );
  });

  testWidgets('toggling a switch flips it and persists', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    // Flip "Replies" (turnCompleted) off.
    await tester.tap(find.widgetWithText(SwitchListTile, 'Replies'));
    await tester.pumpAndSettle();

    final repliesSwitch = tester.widget<SwitchListTile>(
      find.widgetWithText(SwitchListTile, 'Replies'),
    );
    expect(repliesSwitch.value, isFalse);

    // The choice was persisted to the store.
    final stored = await NotificationPreferencesStore(
      preferences: SharedPreferences.getInstance(),
    ).read();
    expect(stored, const NotificationPreferences(turnCompleted: false));
  });

  testWidgets(
    'context indicator selector defaults to percentage and persists a change',
    (tester) async {
      await tester.pumpWidget(_wrap());
      await tester.pumpAndSettle();

      // The three options render; percentage is selected by default.
      await tester.ensureVisible(
        find.byType(SegmentedButton<ContextIndicatorMode>),
      );
      await tester.pumpAndSettle();
      expect(find.text('Percentage'), findsOneWidget);
      expect(find.text('Tokens'), findsOneWidget);
      expect(find.text('Both'), findsOneWidget);
      final segmented = tester.widget<SegmentedButton<ContextIndicatorMode>>(
        find.byType(SegmentedButton<ContextIndicatorMode>),
      );
      expect(segmented.selected, {ContextIndicatorMode.percentage});

      // Choosing "Both" persists it.
      await tester.tap(find.text('Both'));
      await tester.pumpAndSettle();
      final stored = await ConversationPreferencesStore(
        preferences: SharedPreferences.getInstance(),
      ).readContextIndicatorMode();
      expect(stored, ContextIndicatorMode.both.name);
    },
  );
}
