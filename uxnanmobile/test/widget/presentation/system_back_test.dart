import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/devices/my_devices_screen.dart';
import 'package:uxnan/presentation/screens/settings/settings_screen.dart';
import 'package:uxnan/presentation/screens/shell/nav_drawer.dart';
import 'package:uxnan/presentation/screens/shell/shell_welcome.dart';

/// The OS back button, end to end — and the claim the app makes about it
/// BEFORE it is ever pressed.
///
/// On Android the press is not the decision. Predictive back reads
/// `SystemNavigator.setFrameworkHandlesBack`, which Flutter derives from the
/// last `NavigationNotification` to reach `WidgetsApp`; when that says `false`
/// the OS keeps the gesture and closes the app without asking Flutter at all.
/// That is why this went unnoticed for so long: `handlePopRoute` — and the app
/// bar's own arrow, which pops the navigator directly — kept working on the
/// exact screens where a real phone was leaving the app.
///
/// So every test here checks BOTH halves: what the app told the OS, and what
/// the press actually did. Reported from a phone: opening Settings from the
/// overview and pressing back closed the app.
Future<void> main() async {
  /// Every `setFrameworkHandlesBack` claim, in order. The LAST one is what the
  /// OS is acting on.
  late List<bool> claims;

  /// Set when the app asked the OS to close it.
  late List<String> exits;

  setUp(() {
    claims = <bool>[];
    exits = <String>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      switch (call.method) {
        case 'SystemNavigator.setFrameworkHandlesBack':
          claims.add(call.arguments as bool);
        case 'SystemNavigator.pop':
          exits.add(call.method);
      }
      return null;
    });
  });

  /// Pumps the REAL router: the shell navigator, and therefore the whole
  /// question of which navigator answers back, exists only there.
  Future<GoRouter> pump(WidgetTester tester, {required double width}) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final container = ProviderContainer(
      overrides: [
        // Keeps the overview's and the drawer's own data out of a test about
        // navigation — otherwise the real database opens and the test ends
        // with pending timers.
        metricsSnapshotsProvider.overrideWith(_EmptyMetrics.new),
        // An EMPTY snapshot cache falls back to aggregating the whole local
        // database, which opens drift for real; the profile route is one of
        // the four this test walks.
        profileMetricsProvider.overrideWith((ref) async => _noMetrics),
        activityHeatmapProvider.overrideWith((ref, arg) async => const {}),
        // Its agent breakdown asks the bridge, and an unanswered RPC leaves a
        // 30 s timeout behind — on the tablet too, where Settings opens the
        // profile into its own pane.
        agentsProvider.overrideWith((ref) async => const <AgentDescriptor>[]),
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
    final router = container.read(appRouterProvider);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    // `WidgetsApp` stays silent until the app is alive, so nothing reaches the
    // engine — and nothing reaches this test — without it.
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    return router;
  }

  /// Settles the notification, which is always dispatched post-frame.
  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
  }

  testWidgets('back from Settings returns to the overview, not to the launcher',
      (tester) async {
    // The reported bug, exactly as reported: overview → Settings → back.
    final router = await pump(tester, width: 390);
    unawaited(router.push(AppRoutes.settings));
    await settle(tester);

    expect(find.byType(SettingsScreen), findsOneWidget);
    expect(
      claims.last,
      isTrue,
      reason: 'the app told Android it does not handle back, so Android '
          'closed it instead of popping Settings',
    );

    await tester.binding.handlePopRoute();
    await settle(tester);

    expect(find.byType(MyDevicesScreen), findsOneWidget);
    expect(find.byType(SettingsScreen), findsNothing);
    expect(exits, isEmpty, reason: 'the app left instead of going back');
    // And once home, back belongs to the OS again — otherwise visiting
    // Settings once would leave an app that can never be closed with back.
    expect(claims.last, isFalse);
  });

  testWidgets('back at the overview leaves the app', (tester) async {
    await pump(tester, width: 390);

    expect(claims, isNot(contains(true)));
    await tester.binding.handlePopRoute();
    await settle(tester);

    expect(exits, isNotEmpty, reason: 'the overview trapped the back button');
  });

  for (final route in [
    AppRoutes.settings,
    AppRoutes.profile,
    AppRoutes.pairing,
    AppRoutes.onboarding,
  ]) {
    testWidgets('a phone claims back on $route', (tester) async {
      // These four are the app's full-screen routes, and the shell used to
      // return the router's navigator BARE for them — which unregistered the
      // scope answering for back and published "this app does not handle
      // back". Every one of them closed the app; reaching one from a deeper
      // screen hid it, because pushing onto an already-deep stack changes
      // nothing in the shell and leaves the previous claim standing.
      final router = await pump(tester, width: 390);
      unawaited(router.push(route));
      await settle(tester);

      expect(claims.last, isTrue, reason: '$route handed back to the OS');

      await tester.binding.handlePopRoute();
      await settle(tester);

      expect(find.byType(MyDevicesScreen), findsOneWidget);
      expect(exits, isEmpty);
    });
  }

  testWidgets('a destination opened over the drawer pops back to it',
      (tester) async {
    // Same bug on a tablet — Settings is full screen at every width, so it
    // published the same claim there.
    final router = await pump(tester, width: 1280);
    unawaited(router.push(AppRoutes.settings));
    await settle(tester);

    expect(find.byType(NavDrawer), findsNothing);
    expect(claims.last, isTrue);

    await tester.binding.handlePopRoute();
    await settle(tester);

    expect(find.byType(NavDrawer), findsOneWidget);
    expect(exits, isEmpty);
  });

  testWidgets('back empties a pane that was opened, not stacked',
      (tester) async {
    // Beside a permanent drawer, opening REPLACES the pane's route instead of
    // stacking on it, so the navigator holds exactly one page and says it has
    // nothing to pop. It says so from BELOW the scope that handles back here,
    // which is late enough to overrule it: the tablet's "back empties the
    // pane" was published to Android as "this app does not handle back", and
    // the first press closed an app visibly full of your work.
    final router = await pump(tester, width: 1280);
    router.go(AppRoutes.deviceArchived('x'));
    await settle(tester);

    expect(find.byType(NavDrawer), findsOneWidget);
    expect(claims.last, isTrue);

    await tester.binding.handlePopRoute();
    await settle(tester);

    expect(find.byType(ShellWelcome), findsOneWidget);
    expect(exits, isEmpty);
  });
}

/// A profile with nothing in it: this test walks THROUGH the profile route,
/// it never reads what the screen says.
final _noMetrics = ProfileMetrics(
  conversations: 0,
  agentsUsed: 0,
  modelsUsed: 0,
  messages: 0,
  gitActions: 0,
  sessions: 0,
  totalConnected: Duration.zero,
  longestSession: Duration.zero,
  relaySessions: 0,
  directSessions: 0,
  byAgent: const [],
  memberSince: DateTime.utc(2026),
  mostUsedTransport: ConnectionTransport.direct,
);

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
