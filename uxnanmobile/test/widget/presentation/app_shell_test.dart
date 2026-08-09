import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/shell/app_shell.dart';
import 'package:uxnan/presentation/screens/shell/app_shell_screen.dart';
import 'package:uxnan/presentation/screens/shell/nav_drawer.dart';

/// The shell decides, per window width, whether a routed screen IS the window
/// or sits beside a drawer.
///
/// Navigation tests before layout tests, because the shell wraps the router and
/// the router touches everything: the failure that costs most here is not an
/// ugly drawer, it is a phone that quietly gained a layer.
Future<void> main() async {
  /// Sizes the SURFACE, not just the MediaQuery: the shell measures its own
  /// constraints (a pane inside a pane must not read the window), so a
  /// MediaQuery alone would leave it at the 800 dp default and never widen.
  Future<void> pump(
    WidgetTester tester, {
    required double width,
    required String location,
  }) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          // Keeps the drawer's own data out of a test about layout.
          trustedDevicesProvider.overrideWith((ref) => Stream.value(const [])),
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: AppShell(
            location: location,
            child: const Text('routed screen'),
          ),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('a phone gets the screen and nothing else', (tester) async {
    await pump(tester, width: 390, location: AppRoutes.home);

    // Literally `child` — not a hidden drawer, not a collapsed pane. The stack
    // that exists today has to keep working exactly as it does.
    expect(find.text('routed screen'), findsOneWidget);
    expect(find.byType(NavDrawer), findsNothing);
    expect(find.byType(TwoPaneScaffold), findsNothing);
  });

  testWidgets('a wide window puts the screen beside a drawer', (tester) async {
    await pump(tester, width: 1280, location: AppRoutes.home);

    expect(find.byType(TwoPaneScaffold), findsOneWidget);
    expect(find.byType(NavDrawer), findsOneWidget);
    expect(find.text('routed screen'), findsOneWidget);
  });

  testWidgets('pairing and onboarding never sit beside a drawer',
      (tester) async {
    // Nothing to navigate to yet — and in pairing's case a drawer would offer
    // to switch to a PC you are in the middle of adding.
    for (final location in [AppRoutes.onboarding, AppRoutes.pairing]) {
      await pump(tester, width: 1280, location: location);
      expect(
        find.byType(TwoPaneScaffold),
        findsNothing,
        reason: '$location was wrapped in a drawer',
      );
      expect(find.text('routed screen'), findsOneWidget);
    }
  });

  test('the conversation route names the thread the drawer follows', () {
    // A push notification opens `/conversation/:id` with nothing behind it.
    // Without this the drawer has no PC to show and comes up blank — in
    // exactly the case a tablet user is most likely to meet first.
    expect(AppShell.threadIdOf('/conversation/abc123'), 'abc123');
    expect(AppShell.threadIdOf('/conversation/abc123/files'), 'abc123');
    expect(AppShell.threadIdOf('/'), isNull);
    expect(AppShell.threadIdOf('/device/mac-1/threads'), isNull);
    expect(AppShell.threadIdOf('/conversation/'), isNull);
  });

  test('only pairing and onboarding are full-screen', () {
    expect(AppShell.isFullScreen(AppRoutes.onboarding), isTrue);
    expect(AppShell.isFullScreen(AppRoutes.pairing), isTrue);
    expect(AppShell.isFullScreen(AppRoutes.manualPairing), isTrue);
    expect(AppShell.isFullScreen(AppRoutes.home), isFalse);
    expect(AppShell.isFullScreen('/conversation/x'), isFalse);
    expect(AppShell.isFullScreen(AppRoutes.settings), isFalse);
  });
}
