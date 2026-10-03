import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/client_presence.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/thread_preview_provider.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/shell/nav_drawer.dart';

/// The drawer's header is the PC switcher — with ONE PC too, because its menu
/// is also where a tablet manages its PCs and pairs another, which it had no
/// way to reach at all.
void main() {
  TrustedDevice pc(String id) => TrustedDevice(
        macDeviceId: id,
        displayName: 'PC $id',
        macIdentityPublicKey: Uint8List(32),
        sessionId: 's-$id',
        pairedAt: DateTime(2026),
      );

  Future<String> pumpDrawer(WidgetTester tester) async {
    var opened = '';
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (_, __) => const Scaffold(
            body: SizedBox(width: 320, child: NavDrawer(deviceId: 'mac-1')),
          ),
        ),
        GoRoute(
          path: AppRoutes.devices,
          builder: (_, __) {
            opened = AppRoutes.devices;
            return const Text('manage PCs');
          },
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          trustedDevicesProvider
              .overrideWith((ref) => Stream.value([pc('mac-1')])),
          connectedDeviceProvider
              .overrideWith((ref) => Stream.value(pc('mac-1'))),
          threadsProvider.overrideWith((ref) => Stream.value(const [])),
          projectsProvider.overrideWith((ref, id) => Stream.value(const [])),
          workspaceRepoTableProvider.overrideWith((ref) async => const {}),
          threadPreviewProvider.overrideWith((ref, key) async => null),
          threadQueuesProvider.overrideWith(
            (ref) => Stream.value(const <String, ThreadQueueState>{}),
          ),
          awaitingInputProvider.overrideWith(
            (ref) => Stream.value(const <String, Set<String>>{}),
          ),
          threadActivityProvider.overrideWith((ref) => Stream.value(const {})),
          unreadThreadsProvider.overrideWith(
            (ref) => Stream.value(const <String>{}),
          ),
          bridgePresenceProvider
              .overrideWith((ref) => Stream.value(const <ClientPresence>[])),
          bridgeStatusProvider.overrideWith((ref) async => null),
          connectingDeviceProvider.overrideWith((ref) => Stream.value(null)),
        ],
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    return opened;
  }

  testWidgets('one PC still opens the PC menu, and it manages PCs',
      (tester) async {
    await pumpDrawer(tester);

    await tester.tap(find.text('PC mac-1'));
    await tester.pumpAndSettle();
    expect(find.text('Manage PCs'), findsOneWidget);
    // Pairing nests its two ways in a submenu beside its row.
    await tester.tap(find.text('Pair a device'));
    await tester.pumpAndSettle();
    expect(find.text('Scan QR code'), findsOneWidget);
    expect(find.text('Pair with a code'), findsOneWidget);
    await tester.tapAt(const Offset(1200, 700));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Manage PCs'));
    await tester.pumpAndSettle();
    expect(find.text('manage PCs'), findsOneWidget);
  });
}
