import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
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

Widget _wrap({required List<TrustedDevice> devices}) {
  final router = GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, __) => const MyDevicesScreen()),
    ],
  );
  return ProviderScope(
    overrides: [
      trustedDevicesProvider.overrideWith((ref) => Stream.value(devices)),
      activeMacProvider.overrideWith((ref) => Stream.value(null)),
      connectionPhaseProvider
          .overrideWith((ref) => Stream.value(ConnectionPhase.disconnected)),
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

  testWidgets('shows the pair empty state with no devices', (tester) async {
    await tester.pumpWidget(_wrap(devices: const []));
    await tester.pump();

    expect(find.text('No active sessions'), findsOneWidget);
    expect(find.text('Pair a device'), findsOneWidget);
  });
}
