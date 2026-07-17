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
import 'package:uxnan/presentation/widgets/connected_button_group.dart';

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

/// Opens the section reached by tapping [sectionTitle] on the settings landing.
Future<void> _openSection(WidgetTester tester, String sectionTitle) async {
  await tester.tap(find.text(sectionTitle));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('landing lists the sections and shows no inline toggles', (
    tester,
  ) async {
    // A tall surface so the whole (lazily-built) landing lays out on screen.
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    // Grouped section headers…
    expect(find.text('General'), findsOneWidget);
    expect(find.text('Workspace'), findsOneWidget);
    expect(find.text('System'), findsOneWidget);
    // …and the section entries under them.
    expect(find.text('Personalization'), findsOneWidget);
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Metrics & provider usage'), findsOneWidget);
    expect(find.text('Conversation'), findsOneWidget);
    expect(find.text('Source control'), findsOneWidget);
    expect(find.text('Updates'), findsOneWidget);
    expect(find.text('About Uxnan'), findsOneWidget);
    // Models moved into Conversation; Licenses lives inside About.
    expect(find.text('Models'), findsNothing);
    expect(find.text('Open-source licenses'), findsNothing);
    // No option toggles live on the landing itself.
    expect(find.byType(Switch), findsNothing);
  });

  testWidgets('Notifications section: both toggles on by default', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    await _openSection(tester, 'Notifications');

    expect(find.text('Replies'), findsOneWidget);
    expect(find.text('Errors'), findsOneWidget);
    expect(
      tester.widgetList<Switch>(find.byType(Switch)).every((s) => s.value),
      isTrue,
    );
  });

  testWidgets('Notifications section: toggling a switch flips and persists', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();
    await _openSection(tester, 'Notifications');

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
    'Conversation section: context indicator defaults to percentage and '
    'persists a change',
    (tester) async {
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_wrap());
      await tester.pumpAndSettle();
      await _openSection(tester, 'Conversation');

      await tester.ensureVisible(
        find.byType(ConnectedButtonGroup<ContextIndicatorMode>),
      );
      await tester.pumpAndSettle();
      expect(find.text('Percentage'), findsOneWidget);
      expect(find.text('Tokens'), findsOneWidget);
      expect(find.text('Both'), findsOneWidget);
      final group = tester.widget<ConnectedButtonGroup<ContextIndicatorMode>>(
        find.byType(ConnectedButtonGroup<ContextIndicatorMode>),
      );
      expect(group.selected, ContextIndicatorMode.percentage);

      // Choosing "Both" persists it.
      await tester.tap(find.text('Both'));
      await tester.pumpAndSettle();
      final stored = await ConversationPreferencesStore(
        preferences: SharedPreferences.getInstance(),
      ).readContextIndicatorMode();
      expect(stored, ContextIndicatorMode.both.name);
    },
  );

  testWidgets(
    'Conversation section: Claude latest-models toggle defaults on and '
    'persists off',
    (tester) async {
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_wrap());
      await tester.pumpAndSettle();
      await _openSection(tester, 'Conversation');

      final toggle = find.widgetWithText(
        SwitchListTile,
        'Show Claude Code “latest” models',
      );
      expect(toggle, findsOneWidget);
      expect(tester.widget<SwitchListTile>(toggle).value, isTrue);

      await tester.ensureVisible(toggle);
      await tester.tap(toggle);
      await tester.pumpAndSettle();

      expect(tester.widget<SwitchListTile>(toggle).value, isFalse);
      final stored = await ConversationPreferencesStore(
        preferences: SharedPreferences.getInstance(),
      ).readShowClaudeLatest();
      expect(stored, isFalse);
    },
  );
}
