import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/shell/nav_drawer.dart';

/// With nothing paired, the drawer's header IS the call to action — it is the
/// only thing that can be done from there at all.
void main() {
  testWidgets('the empty drawer opens onboarding, not the camera',
      (tester) async {
    // Whoever reaches this button has no PC paired, which usually means no
    // bridge installed either. A camera pointed at nothing is a dead end that
    // explains none of that; onboarding installs the bridge and then hands off
    // to the very same scanner.
    var pushed = '';
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) =>
              const Scaffold(body: NavDrawer(deviceId: null)),
        ),
        GoRoute(
          path: AppRoutes.onboarding,
          builder: (context, state) {
            pushed = AppRoutes.onboarding;
            return const SizedBox();
          },
        ),
        GoRoute(
          path: AppRoutes.pairing,
          builder: (context, state) {
            pushed = AppRoutes.pairing;
            return const SizedBox();
          },
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          trustedDevicesProvider.overrideWith((ref) => Stream.value(const [])),
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
          threadsProvider.overrideWith((ref) => Stream.value(const [])),
        ],
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(pushed, AppRoutes.onboarding);
  });
}
