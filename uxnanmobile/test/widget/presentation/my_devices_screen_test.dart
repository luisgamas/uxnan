import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/devices/my_devices_screen.dart';

/// The relay host every [_device] advertises, so a test can drive the relay
/// network-kind badge by passing `connectedEndpoint: kRelayUrl`.
const kRelayUrl = 'wss://relay.uxnan.dev';

TrustedDevice _device(String id, String name) => TrustedDevice(
      macDeviceId: id,
      displayName: name,
      macIdentityPublicKey: Uint8List(32),
      relayUrl: kRelayUrl,
      sessionId: 's-$id',
      pairedAt: DateTime(2026, 6, 3),
      lastSeen: DateTime(2026, 6, 6, 9),
    );

Widget _wrap({
  required List<TrustedDevice> devices,
  TrustedDevice? connected,
  TrustedDevice? connecting,
  String? connectedEndpoint,
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
      connectingDeviceProvider.overrideWith((ref) => Stream.value(connecting)),
      connectedEndpointProvider
          .overrideWith((ref) => Stream.value(connectedEndpoint)),
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

  testWidgets(
      'shows the network-kind badge derived from the actual endpoint, '
      'not bridge/status', (tester) async {
    final device = _device('mac-1', 'My Mac');
    await tester.pumpWidget(
      _wrap(
        devices: [device],
        connected: device,
        // The live channel is served through the device's own relay host.
        connectedEndpoint: kRelayUrl,
      ),
    );
    await tester.pump();

    expect(find.text('Connected'), findsOneWidget);
    expect(find.text('Relay'), findsOneWidget);
  });

  testWidgets('shows a LAN badge for a private-network endpoint', (
    tester,
  ) async {
    final device = _device('mac-1', 'My Mac');
    await tester.pumpWidget(
      _wrap(
        devices: [device],
        connected: device,
        connectedEndpoint: 'ws://192.168.1.42:8765',
      ),
    );
    await tester.pump();

    expect(find.text('LAN'), findsOneWidget);
  });

  testWidgets('shows a Tailscale badge for a 100.64.0.0/10 endpoint', (
    tester,
  ) async {
    final device = _device('mac-1', 'My Mac');
    await tester.pumpWidget(
      _wrap(
        devices: [device],
        connected: device,
        connectedEndpoint: 'ws://100.90.10.5:8765',
      ),
    );
    await tester.pump();

    expect(find.text('Tailscale'), findsOneWidget);
  });

  testWidgets('shows a Direct badge for a public/other endpoint', (
    tester,
  ) async {
    final device = _device('mac-1', 'My Mac');
    await tester.pumpWidget(
      _wrap(
        devices: [device],
        connected: device,
        connectedEndpoint: 'ws://203.0.113.5:8765',
      ),
    );
    await tester.pump();

    expect(find.text('Direct'), findsOneWidget);
  });

  testWidgets('shows one detecting status while this PC is connecting', (
    tester,
  ) async {
    final device = _device('mac-1', 'My Mac');
    await tester.pumpWidget(
      _wrap(devices: [device], connecting: device),
    );
    await tester.pump();

    // The status uses "Detecting…" as the single card-level progress state;
    // the button keeps its normal busy label and behavior.
    expect(find.text('Connecting…'), findsOneWidget);
    expect(find.text('Detecting…'), findsOneWidget);
  });

  testWidgets('shows the real connected endpoint, not the advertised host', (
    tester,
  ) async {
    final device = _device('mac-1', 'My Mac');
    await tester.pumpWidget(
      _wrap(
        devices: [device],
        connected: device,
        // The live channel actually won a direct LAN host; the card must show
        // it (host:port) rather than the paired relay host.
        connectedEndpoint: 'ws://192.168.1.42:8765',
      ),
    );
    await tester.pump();

    expect(find.text('192.168.1.42:8765'), findsOneWidget);
    expect(find.text('relay.uxnan.dev'), findsNothing);
  });

  testWidgets('the address is tap-to-reveal (blurred by default)', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(devices: [_device('mac-1', 'My Mac')]),
    );
    await tester.pump();

    // Hidden by default: the "reveal" affordance is shown.
    expect(find.byIcon(Icons.visibility_rounded), findsOneWidget);
    expect(find.byIcon(Icons.visibility_off_rounded), findsNothing);

    // Tapping the address reveals it (affordance flips to "hide") without
    // navigating away — the screen (and its card) are still on screen.
    await tester.tap(find.byIcon(Icons.visibility_rounded));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.visibility_off_rounded), findsOneWidget);
    expect(find.text('My Mac'), findsOneWidget);
  });

  testWidgets('shows the pair empty state with no devices', (tester) async {
    await tester.pumpWidget(_wrap(devices: const []));
    await tester.pump();

    expect(find.text('No active sessions'), findsOneWidget);
    expect(find.text('Pair a device'), findsOneWidget);
    expect(find.text('Devices'), findsOneWidget);
    expect(find.byKey(const ValueKey('devices-empty-logo')), findsOneWidget);
    expect(find.byIcon(Icons.person_outline_rounded), findsOneWidget);
    expect(find.byIcon(Icons.settings_outlined), findsOneWidget);
    expect(find.byIcon(Icons.hub_outlined), findsNothing);
  });
}
