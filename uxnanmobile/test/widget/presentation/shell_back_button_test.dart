import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/devices/my_devices_screen.dart';
import 'package:uxnan/presentation/screens/shell/shell_welcome.dart';

/// The OS back button does not reach a `Navigator` directly: it goes to
/// `GoRouterDelegate.popRoute`, which walks every `ShellRouteMatch` and
/// dereferences `navigatorKey.currentState!` on the way.
///
/// So an unmounted shell navigator is not a layout problem — it is a crash on
/// the back button, for the whole app, from a screen that looks fine. This
/// pumps the REAL router (the shell exists only there) rather than `AppShell`
/// with a stand-in child.
Future<void> main() async {
  Future<void> pump(WidgetTester tester, {required double width}) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final container = ProviderContainer(
      overrides: [
        // Keeps the drawer's and the overview's own data out of a test about
        // navigation. The narrow root really is the overview screen, so this
        // has to feed everything that screen reads — otherwise it opens the
        // real drift database and the test ends with pending timers.
        metricsSnapshotsProvider.overrideWith(_EmptyMetrics.new),
        profileNameProvider.overrideWith(_FixedName.new),
        trustedDevicesProvider.overrideWith((ref) => Stream.value(const [])),
        connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
        connectingDeviceProvider.overrideWith((ref) => Stream.value(null)),
        connectedEndpointProvider.overrideWith((ref) => Stream.value(null)),
        threadsProvider.overrideWith((ref) => Stream.value(const [])),
        threadActivityProvider.overrideWith((ref) => Stream.value(const {})),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: container.read(appRouterProvider),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('the back button works at the root of a wide window',
      (tester) async {
    // Reported from a tablet, as a red screen after dismissing two sheets:
    // "Null check operator used on a null value" at
    // `GoRouterDelegate._findCurrentNavigator`. The sheets were incidental —
    // back was broken the whole time the overview was open, because the shell
    // swapped the router's navigator out for the welcome pane.
    await pump(tester, width: 1280);

    expect(
      shellNavigatorKey.currentState,
      isNotNull,
      reason: 'the shell navigator is unmounted — back will throw',
    );
    await tester.binding.handlePopRoute();
    await tester.pump();
  });

  testWidgets('the back button works at the root of a phone', (tester) async {
    // The narrow layout returns `child` untouched, so this has always held —
    // which is exactly why the tablet case went unnoticed.
    await pump(tester, width: 390);

    expect(shellNavigatorKey.currentState, isNotNull);
    await tester.binding.handlePopRoute();
    await tester.pump();
  });

  // Moving the decision out of the shell and into the route must not change
  // what you SEE. One test per width: each needs its own provider container,
  // and pumping a second app over the first leaves the first one's timers
  // running.

  testWidgets('a wide root stays quiet', (tester) async {
    // The drawer is already showing your PCs and their work; repeating the
    // overview beside it would say the same thing twice.
    await pump(tester, width: 1280);

    expect(find.byType(ShellWelcome), findsOneWidget);
    expect(find.byType(MyDevicesScreen), findsNothing);
  });

  testWidgets('a phone root IS the overview', (tester) async {
    await pump(tester, width: 390);

    expect(find.byType(MyDevicesScreen), findsOneWidget);
    expect(find.byType(ShellWelcome), findsNothing);
  });
}

/// Metrics that resolve instantly with nothing, so the overview's header does
/// not reach the cache store or schedule its refresh poll.
class _EmptyMetrics extends MetricsController {
  @override
  Future<Map<String, MetricsSnapshot>> build() async => const {};
}

/// A profile name that needs no store behind it.
class _FixedName extends ProfileName {
  @override
  String? build() => 'Tester';
}
