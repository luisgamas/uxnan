import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/bridge_status.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/devices/my_devices_screen.dart';

TrustedDevice _device(String id, String name) => TrustedDevice(
      macDeviceId: id,
      displayName: name,
      macIdentityPublicKey: Uint8List(32),
      relayUrl: 'wss://relay.uxnan.dev',
      sessionId: 's-$id',
      pairedAt: DateTime(2026, 6, 3),
      lastSeen: DateTime(2026, 6, 6, 9),
    );

Widget _wrap({
  required List<TrustedDevice> devices,
  TrustedDevice? connected,
  BridgeStatus? bridgeStatus,
}) {
  final router = GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, __) => const MyDevicesScreen()),
    ],
  );
  return ProviderScope(
    overrides: [
      trustedDevicesProvider.overrideWith((ref) => Stream.value(devices)),
      connectedDeviceProvider.overrideWith((ref) => Stream.value(connected)),
      connectingDeviceProvider.overrideWith((ref) => Stream.value(null)),
      bridgeStatusProvider.overrideWith((ref) async => bridgeStatus),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    ),
  );
}

void main() {
  testWidgets('renders a card per paired PC with a connect action', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(devices: [_device('mac-1', "Jorge's MacBook")]),
    );
    await tester.pump();

    expect(find.text("Jorge's MacBook"), findsOneWidget);
    expect(find.text('relay.uxnan.dev'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Connect'), findsOneWidget);
  });

  testWidgets('offers a Remove device action that confirms first', (
    tester,
  ) async {
    // A roomy surface so the popup menu / dialog lay out without overflow.
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _wrap(devices: [_device('mac-1', "Jorge's MacBook")]),
    );
    await tester.pump();

    await tester.tap(find.byIcon(Icons.more_vert_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Remove device'), findsOneWidget);

    await tester.tap(find.text('Remove device'));
    await tester.pumpAndSettle();
    // Destructive: it asks for confirmation, naming the device.
    expect(find.text("Remove Jorge's MacBook?"), findsOneWidget);

    // Cancelling keeps the device (no provider work triggered).
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text("Jorge's MacBook"), findsOneWidget);
  });

  testWidgets('shows the transport (relay vs direct) on the connected PC', (
    tester,
  ) async {
    final device = _device('mac-1', 'My Mac');
    await tester.pumpWidget(
      _wrap(
        devices: [device],
        connected: device,
        bridgeStatus: const BridgeStatus(relayConnected: true),
      ),
    );
    await tester.pump();

    expect(find.text('Connected'), findsOneWidget);
    expect(find.text('· Relay'), findsOneWidget);
  });

  testWidgets('shows a direct transport when not over the relay', (
    tester,
  ) async {
    final device = _device('mac-1', 'My Mac');
    await tester.pumpWidget(
      _wrap(
        devices: [device],
        connected: device,
        bridgeStatus: const BridgeStatus(relayConnected: false),
      ),
    );
    await tester.pump();

    expect(find.text('· Direct'), findsOneWidget);
  });

  testWidgets('shows the pair empty state with no devices', (tester) async {
    await tester.pumpWidget(_wrap(devices: const []));
    await tester.pump();

    expect(find.text('No active sessions'), findsOneWidget);
    expect(find.text('Pair a device'), findsOneWidget);
  });
}
