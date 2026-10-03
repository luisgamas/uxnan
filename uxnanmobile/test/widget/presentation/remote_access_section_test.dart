import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/action_outbox.dart';
import 'package:uxnan/application/managers/relay_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/value_objects/relay_endpoint.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/relay_setup_screen.dart';
import 'package:uxnan/presentation/screens/profile/remote_access_section.dart';

import '../../support/relay_fakes.dart';

TrustedDevice _pc({RelayEndpoint? relay}) => TrustedDevice(
      macDeviceId: 'mac-1',
      displayName: 'Studio',
      macIdentityPublicKey: Uint8List(32),
      sessionId: 's-1',
      pairedAt: DateTime(2026, 3, 3),
      relay: relay,
    );

const _stored = RelayEndpoint(
  url: 'wss://uxnan-relay.example.workers.dev',
  routingId: testRoutingId,
  enabled: true,
);

/// The section over a real [RelayManager] driven by a fake bridge that
/// answers in the contract's shape.
class _Harness {
  _Harness(this.bridge, {required this.connected}) {
    manager = RelayManager(
      sendRequest: bridge.send,
      sendCloudflareRequest: bridge.sendViaCloudflare,
      domainEvents: const Stream<DomainEvent>.empty(),
      connectionPhases: phases.stream,
      currentDeviceId: () => connected ? 'mac-1' : null,
      outbox: ActionOutbox(repository: actions),
    );
  }

  final FakeRelayBridge bridge;
  final bool connected;
  final StreamController<ConnectionPhase> phases =
      StreamController<ConnectionPhase>.broadcast();
  final InMemoryActionRepository actions = InMemoryActionRepository();
  late final RelayManager manager;

  List<String> get methods => [for (final r in bridge.requests) r.$1];

  Future<void> pump(WidgetTester tester, {RelayEndpoint? stored}) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);
    final device = _pc(relay: stored);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          trustedDevicesProvider.overrideWith((ref) => Stream.value([device])),
          connectedDeviceProvider.overrideWith(
            (ref) => Stream.value(connected ? device : null),
          ),
          relayManagerProvider.overrideWithValue(manager),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                RemoteAccessSection(deviceId: 'mac-1', isConnected: connected),
              ],
            ),
          ),
        ),
      ),
    );
    if (connected) phases.add(ConnectionPhase.connected);
    await tester.pumpAndSettle();
  }
}

void main() {
  testWidgets('no relay yet: the three ways, and setting up the third',
      (tester) async {
    final h = _Harness(
      FakeRelayBridge(relayStatusJson(setUp: false)),
      connected: true,
    );
    await h.pump(tester);

    expect(find.text('Remote access'), findsOneWidget);
    expect(find.text('Same network'), findsOneWidget);
    expect(find.text('Tailscale'), findsOneWidget);
    expect(find.text('Your own relay'), findsOneWidget);
    expect(
      find.text('Works from any network. Needs a free Cloudflare account.'),
      findsOneWidget,
    );

    await tester.tap(find.text('Set up your relay'));
    await tester.pumpAndSettle();
    expect(find.byType(RelaySetupScreen), findsOneWidget);
  });

  testWidgets('a PC that is not connected asks to connect before setting up',
      (tester) async {
    final h = _Harness(FakeRelayBridge(relayStatusJson()), connected: false);
    await h.pump(tester);

    expect(find.text('Set up your relay'), findsNothing);
    expect(
      find.text('Connect to this PC to set up or manage its relay.'),
      findsOneWidget,
    );
    expect(h.bridge.requests, isEmpty);
  });

  testWidgets('a working relay shows its address, state and phones',
      (tester) async {
    final h = _Harness(
      FakeRelayBridge(relayStatusJson(connectedPhones: 2)),
      connected: true,
    );
    await h.pump(tester);

    expect(find.text('uxnan-relay.example.workers.dev'), findsOneWidget);
    expect(find.text('Connected'), findsOneWidget);
    expect(find.text('2 phones connected through it'), findsOneWidget);
    expect(find.text('Reach this PC from anywhere'), findsOneWidget);
    expect(find.text('New address'), findsOneWidget);
    expect(find.text('Remove relay'), findsOneWidget);
    // Same version deployed as shipped: nothing to update.
    expect(find.text('Update relay'), findsNothing);
  });

  testWidgets('a relay that is not working says why, in the bridge words',
      (tester) async {
    final h = _Harness(
      FakeRelayBridge(
        relayStatusJson(
          state: 'error',
          lastError: 'Cloudflare rejected the token.',
          connectedPhones: 0,
        ),
      ),
      connected: true,
    );
    await h.pump(tester);

    expect(find.text('Not working'), findsOneWidget);
    expect(find.text('Cloudflare rejected the token.'), findsOneWidget);
    expect(find.text('No phones connected through it'), findsOneWidget);
  });

  testWidgets('update asks for the token when the PC remembers none',
      (tester) async {
    final h = _Harness(
      FakeRelayBridge(relayStatusJson(bundledVersion: '0.2.0')),
      connected: true,
    );
    await h.pump(tester);

    expect(find.text('Version 0.2.0 is available'), findsOneWidget);
    await tester.tap(find.text('Update relay'));
    await tester.pumpAndSettle();
    expect(find.text('Cloudflare API token'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'tok-123');
    await tester.pump();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(h.methods.last, 'relay/update');
    expect(
      h.bridge.requests.last.$2,
      {'apiToken': 'tok-123', 'remember': false},
    );
    expect(h.bridge.viaCloudflare, ['relay/update']);
    expect(find.text('Your relay is up to date.'), findsOneWidget);
  });

  testWidgets('a remembered token updates without asking', (tester) async {
    final h = _Harness(
      FakeRelayBridge(
        relayStatusJson(bundledVersion: '0.2.0', tokenRemembered: true),
      ),
      connected: true,
    );
    await h.pump(tester);

    await tester.tap(find.text('Update relay'));
    await tester.pumpAndSettle();
    expect(find.text('Cloudflare API token'), findsNothing);
    expect(h.bridge.requests.last.$2, isEmpty);
  });

  testWidgets('the switch asks the connected PC', (tester) async {
    final h = _Harness(FakeRelayBridge(relayStatusJson()), connected: true);
    await h.pump(tester);

    h.bridge.status = relayStatusJson(enabled: false, state: 'off');
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(h.methods.last, 'relay/set');
    expect(h.bridge.requests.last.$2, {'enabled': false});
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
    expect(find.text('Off'), findsOneWidget);
  });

  testWidgets('the switch is kept while the PC is out of reach',
      (tester) async {
    final h = _Harness(FakeRelayBridge(relayStatusJson()), connected: false);
    await h.pump(tester, stored: _stored);

    // The relay the PC last shared, and only the switch to act on.
    expect(find.text('uxnan-relay.example.workers.dev'), findsOneWidget);
    expect(find.text('On'), findsOneWidget);
    expect(find.text('New address'), findsNothing);

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(h.bridge.requests, isEmpty);
    expect(
      find.text("Saved. Your PC hears it the next time it's reachable."),
      findsOneWidget,
    );
    expect(
      find.text('Turns off when the PC is reachable again.'),
      findsOneWidget,
    );
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
  });

  testWidgets('a new address is asked for first', (tester) async {
    final h = _Harness(FakeRelayBridge(relayStatusJson()), connected: true);
    await h.pump(tester);

    await tester.tap(find.text('New address'));
    await tester.pumpAndSettle();
    expect(find.text('Give your relay a new address?'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'New address'));
    await tester.pumpAndSettle();
    expect(h.methods.last, 'relay/rotate');
    expect(find.text('Your relay has a new address.'), findsOneWidget);
  });

  testWidgets('removing and deleting from Cloudflare asks for the token there',
      (tester) async {
    final h = _Harness(FakeRelayBridge(relayStatusJson()), connected: true);
    await h.pump(tester);

    await tester.tap(find.text('Remove relay'));
    await tester.pumpAndSettle();
    expect(find.text('Remove your relay?'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);

    await tester.tap(find.text('Also delete it from your Cloudflare account'));
    await tester.pumpAndSettle();
    final remove = find.widgetWithText(FilledButton, 'Remove');
    expect(tester.widget<FilledButton>(remove).onPressed, isNull);

    await tester.enterText(find.byType(TextField), 'tok-9');
    await tester.pump();
    await tester.tap(remove);
    await tester.pumpAndSettle();

    expect(h.methods.last, 'relay/remove');
    expect(h.bridge.requests.last.$2, {
      'deleteWorker': true,
      'apiToken': 'tok-9',
      'remember': false,
    });
    expect(find.text('Relay removed.'), findsOneWidget);
  });

  testWidgets('a refusal is shown as the bridge wrote it', (tester) async {
    final h = _Harness(FakeRelayBridge(relayStatusJson()), connected: true);
    h.bridge.refusals['relay/rotate'] = 'Another rotation is running.';
    await h.pump(tester);

    await tester.tap(find.text('New address'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'New address'));
    await tester.pumpAndSettle();
    expect(find.text('Another rotation is running.'), findsOneWidget);
  });
}
