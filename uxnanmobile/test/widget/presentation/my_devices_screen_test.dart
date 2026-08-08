import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/devices/my_devices_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';

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

/// A metrics controller that resolves instantly with nothing.
///
/// The overview's welcome header reads `memberSince` from the bridge-owned
/// ledger, so mounting this screen now builds the metrics controller. The real
/// one talks to the cache store and schedules a refresh poll — asynchronous
/// work a widget test would leave pending after the tree is gone. Returning an
/// empty map also exercises the honest path: a phone that has never synced
/// metrics simply drops the "member since" fragment.
class _EmptyMetricsController extends MetricsController {
  @override
  Future<Map<String, MetricsSnapshot>> build() async => const {};
}

Widget _wrap({
  required List<TrustedDevice> devices,
  TrustedDevice? connected,
  TrustedDevice? connecting,
  String? connectedEndpoint,
  List<Thread> threads = const [],
  Map<String, ThreadActivity> activity = const {},
  String? profileName,
}) {
  final router = GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, __) => const MyDevicesScreen()),
    ],
  );
  return ProviderScope(
    overrides: [
      metricsSnapshotsProvider.overrideWith(_EmptyMetricsController.new),
      if (profileName != null)
        profileNameProvider.overrideWith(() => _FixedName(profileName)),
      // The device card's signal line is derived from the phone's own thread
      // cache, so this screen now reads the thread manager. Feeding the two
      // streams directly keeps the real manager (drift, transport, its poll
      // timers) out of a widget test.
      threadsProvider.overrideWith((ref) => Stream.value(threads)),
      threadActivityProvider.overrideWith((ref) => Stream.value(activity)),
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

    // Status and network path share one cell: the live path IS the status.
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
    expect(find.byKey(const ValueKey('devices-empty-logo')), findsOneWidget);
    // The bar carries the product's identity, not the screen's: the mark on
    // the left, the avatar on the right.
    expect(find.byType(ProfileAvatarView), findsOneWidget);
    expect(find.byIcon(Icons.settings_outlined), findsOneWidget);
    expect(find.byIcon(Icons.hub_outlined), findsNothing);
  });

  // The two widths a Pixel 10 Pro XL actually reports (1344 × 2992 px at
  // density 480 → 448 dp portrait, 997 dp landscape), so these cases are the
  // ones a reviewer can reproduce by rotating the emulator.
  group('adapts to the window width', () {
    Future<void> pumpAt(WidgetTester tester, Size size) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(_wrap(devices: [_device('mac-1', 'My Mac')]));
      await tester.pump();
    }

    testWidgets('phone portrait: the card spans the window', (tester) async {
      await pumpAt(tester, const Size(448, 900));

      // The screen's own 16 dp gutter, and nothing else — proof that turning
      // `constrainContent` on did not touch the compact layout.
      expect(
        tester.getSize(find.byType(NeCard).first).width,
        448 - UxnanSpacing.lg * 2,
      );
    });

    testWidgets('phone landscape: the card stops growing at 840 dp', (
      tester,
    ) async {
      await pumpAt(tester, const Size(997, 448));

      expect(
        tester.getSize(find.byType(NeCard).first).width,
        840 - UxnanSpacing.lg * 2,
      );
    });

    testWidgets('two PCs pair up into two columns once the pane fits', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        _wrap(devices: [_device('mac-1', 'One'), _device('mac-2', 'Two')]),
      );
      await tester.pump();

      // 840 dp of content, minus the 16 dp gutters and the 12 dp column gap,
      // split in two.
      const expected = (840 - UxnanSpacing.lg * 2 - UxnanSpacing.md) / 2;
      expect(
        tester.getSize(find.widgetWithText(NeCard, 'One')).width,
        expected,
      );
      expect(
        tester.getSize(find.widgetWithText(NeCard, 'Two')).width,
        expected,
      );
      // Equal heights: the shorter card is stretched, not left ragged.
      expect(
        tester.getSize(find.widgetWithText(NeCard, 'One')).height,
        tester.getSize(find.widgetWithText(NeCard, 'Two')).height,
      );
    });

    testWidgets('a lone PC keeps the full width even on a wide window', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(_wrap(devices: [_device('mac-1', 'One')]));
      await tester.pump();

      // Half a row for a single card would look like a layout bug.
      expect(
        tester.getSize(find.widgetWithText(NeCard, 'One')).width,
        840 - UxnanSpacing.lg * 2,
      );
    });
  });

  group('welcome header', () {
    testWidgets('greets by name once one is set, and heads to the profile', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(devices: [_device('mac-1', 'My Mac')], profileName: 'Jorge'),
      );
      await tester.pump();

      // Two rows: the constant half quiet, the name carrying the weight.
      expect(find.text('Welcome back'), findsOneWidget);
      expect(find.text('Jorge'), findsOneWidget);
      // The headline is the screen's heading, so the bar carries the brand and
      // the avatar instead of a title and a person glyph.
      expect(find.text('Devices'), findsNothing);
      expect(find.byIcon(Icons.person_outline_rounded), findsNothing);
      expect(find.byType(ProfileAvatarView), findsOneWidget);
    });

    testWidgets('without a name it greets plainly — never a placeholder', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(devices: [_device('mac-1', 'My Mac')]));
      await tester.pump();

      expect(find.text('Welcome back'), findsOneWidget);
      expect(find.text('Uxnan user'), findsNothing);
    });

    testWidgets('counts how many of the paired PCs are live', (tester) async {
      final mac = _device('mac-1', 'My Mac');
      await tester.pumpWidget(
        _wrap(devices: [mac, _device('mac-2', 'Studio')], connected: mac),
      );
      await tester.pump();

      // A live badge, not a sentence: how many machines are reachable is the
      // one fact on this screen that changes on its own.
      expect(find.text('1 online now'), findsOneWidget);
      // No metrics cached in this harness: the "member since" fragment is
      // dropped rather than shown as a placeholder date.
      expect(find.textContaining('Member since'), findsNothing);
    });
  });

  testWidgets('the last connection is labelled, never a bare hour', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(devices: [_device('mac-1', 'My Mac')]));
    await tester.pump();

    // A lone "9:00" under a machine name says nothing about what it means.
    expect(find.textContaining('Last connection:'), findsOneWidget);
  });

  testWidgets('a PC that never connected says so instead of a time', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        devices: [
          TrustedDevice(
            macDeviceId: 'mac-1',
            displayName: 'My Mac',
            macIdentityPublicKey: Uint8List(32),
            relayUrl: kRelayUrl,
            sessionId: 's-1',
            pairedAt: DateTime(2026, 6, 3),
          ),
        ],
      ),
    );
    await tester.pump();

    expect(find.text('Never connected'), findsOneWidget);
    expect(find.textContaining('Last connection:'), findsNothing);
  });

  testWidgets('the bar avatar is the same size as the actions beside it', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(devices: [_device('mac-1', 'My Mac')]));
    await tester.pump();

    expect(
      tester.getSize(find.byType(ProfileAvatarView)).width,
      UxnanSize.iconSurface,
    );
  });

  group('device signals', () {
    Thread thread(String id, {String? deviceId = 'mac-1'}) => Thread(
          id: id,
          title: id,
          agentId: 'claude-code',
          syncState: ThreadSyncState.synced,
          status: ThreadStatus.active,
          deviceId: deviceId,
        );

    testWidgets('names the working agents and the conversation count', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          devices: [_device('mac-1', 'My Mac')],
          threads: [thread('t1'), thread('t2'), thread('t3')],
          activity: const {'t1': ThreadActivity.running},
        ),
      );
      // Two frames: the signal line is two provider hops from its stream
      // (threadsProvider → deviceThreadsProvider → widget), so it settles one
      // frame after the card itself.
      await tester.pump();
      await tester.pump();

      expect(find.text('1 working'), findsOneWidget);
      expect(find.text('3 conversations'), findsOneWidget);
    });

    testWidgets('a PC with nothing cached draws no signal line at all', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(devices: [_device('mac-1', 'My Mac')]));
      await tester.pump();

      expect(find.textContaining('conversation'), findsNothing);
      expect(find.textContaining('working'), findsNothing);
    });

    testWidgets('an archived thread is not a conversation', (tester) async {
      await tester.pumpWidget(
        _wrap(
          devices: [_device('mac-1', 'My Mac')],
          threads: [
            thread('t1'),
            const Thread(
              id: 't2',
              title: 't2',
              agentId: 'claude-code',
              syncState: ThreadSyncState.synced,
              status: ThreadStatus.archived,
              deviceId: 'mac-1',
            ),
          ],
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.text('1 conversation'), findsOneWidget);
    });

    testWidgets('an untagged legacy thread is counted for no PC', (
      tester,
    ) async {
      // Shown under every PC while browsing, which is right; counted under
      // every PC would inflate each card by the same threads.
      await tester.pumpWidget(
        _wrap(
          devices: [_device('mac-1', 'My Mac')],
          threads: [thread('t1', deviceId: null)],
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.textContaining('conversation'), findsNothing);
    });
  });
}

/// A profile name that is already set, without touching the real secure store.
class _FixedName extends ProfileName {
  _FixedName(this._name);

  final String _name;

  @override
  String? build() => _name;
}
