import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// The one place that decides what opening and going back mean, exercised
/// through a real router with the app's shell navigator.
void main() {
  late BuildContext probe;

  Widget screen(String name) => Builder(
        builder: (context) {
          probe = context;
          return NeScaffold(
            title: name,
            slivers: [SliverToBoxAdapter(child: Text('screen $name'))],
          );
        },
      );

  Future<GoRouter> pumpRouter(WidgetTester tester, double width) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final router = GoRouter(
      routes: [
        ShellRoute(
          navigatorKey: shellNavigatorKey,
          builder: (_, __, child) => child,
          routes: [
            GoRoute(path: '/', builder: (_, __) => screen('home')),
            GoRoute(
              path: '/device/:id/threads',
              builder: (_, __) => screen('list'),
            ),
            GoRoute(
              path: '/conversation/:id',
              builder: (_, s) => screen('chat ${s.pathParameters['id']}'),
            ),
          ],
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          threadsProvider.overrideWith((ref) => Stream.value(const [])),
          trustedDevicesProvider
              .overrideWith((ref) => Stream.value(const <TrustedDevice>[])),
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    return router;
  }

  testWidgets(
      'emptying the pane asks the screen on top first, and stops if it '
      'declines', (tester) async {
    // A file with unsaved edits sat above the conversation; picking another
    // conversation in the drawer popped it without asking and the edits were
    // gone.
    final router = await pumpRouter(tester, 1280);
    router.go('/conversation/a');
    await tester.pumpAndSettle();
    var asked = 0;
    unawaited(
      shellNavigatorKey.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => PopScope(
            canPop: false,
            onPopInvokedWithResult: (didPop, _) => asked++,
            child: const Text('unsaved edits'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    unawaited(probe.openInPane('/conversation/b'));
    await tester.pumpAndSettle();

    expect(asked, 1, reason: 'the screen was not asked');
    expect(find.text('unsaved edits'), findsOneWidget);
    expect(find.text('screen chat b'), findsNothing);
  });

  testWidgets('what is already open is not opened again', (tester) async {
    // A notification for the conversation on screen pushed a second copy.
    final router = await pumpRouter(tester, 390);
    unawaited(router.push<void>('/conversation/a'));
    await tester.pumpAndSettle();

    unawaited(probe.openInPane('/conversation/a'));
    await tester.pumpAndSettle();
    await probe.closePane();
    await tester.pumpAndSettle();

    expect(find.text('screen home'), findsOneWidget);
  });

  testWidgets(
      'a phone screen with nothing to pop still has a way up (a rotated pane)',
      (tester) async {
    // Rotating a tablet turns a replaced pane into a stack of one. The list
    // showed no arrow, and iOS has no system back: a dead end.
    final router = await pumpRouter(tester, 390);
    router.go('/device/mac-1/threads');
    await tester.pumpAndSettle();

    expect(find.byTooltip('Back'), findsOneWidget);
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.text('screen home'), findsOneWidget);
    expect(
      find.byTooltip('Back'),
      findsNothing,
      reason: 'the overview is the top: nothing above it',
    );
  });
}
