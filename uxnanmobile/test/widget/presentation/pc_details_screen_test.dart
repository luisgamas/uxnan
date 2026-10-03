import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_route.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/pc_details_screen.dart';
import 'package:uxnan/presentation/screens/profile/usage_section.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/ne_badge.dart';

import '../../support/ux_icon_finder.dart';

/// Skips the real `metrics/get` fetch (whose timeout timer would fail the
/// test); paired with an empty `agentsProvider` override for the agent section.
class _NoMetrics extends MetricsController {
  @override
  Future<Map<String, MetricsSnapshot>> build() async =>
      const <String, MetricsSnapshot>{};
}

/// No live limits to ask for: the section renders its empty state.
class _NoUsage extends UsageStatsController {
  @override
  Future<List<ProviderUsage>> build() async => const [];
}

TrustedDevice _device(String id) => TrustedDevice(
      macDeviceId: id,
      displayName: "Jorge's MacBook",
      macIdentityPublicKey: Uint8List(32),
      sessionId: 's-$id',
      pairedAt: DateTime(2026, 3, 3),
      lastSeen: DateTime(2026, 6, 6, 9),
    );

ProfileMetrics _metrics() => const ProfileMetrics(
      conversations: 54,
      agentsUsed: 9,
      modelsUsed: 5,
      messages: 210,
      gitActions: 12,
      sessions: 6,
      totalConnected: Duration(hours: 22),
      longestSession: Duration(hours: 2, minutes: 40),
      relaySessions: 1,
      directSessions: 5,
      byAgent: [AgentUsage(agentId: 'codex', conversations: 30)],
      mostUsedTransport: ConnectionTransport.direct,
    );

void main() {
  testWidgets('PcDetailsScreen renders scoped metrics without crashing',
      (tester) async {
    SharedPreferences.setMockInitialValues(const {});
    tester.view.physicalSize = const Size(1200, 3200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          trustedDevicesProvider
              .overrideWith((ref) => Stream.value([_device('mac-1')])),
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
          bridgeStatusProvider.overrideWith((ref) async => null),
          pcMetricsProvider.overrideWith((ref, id) async => _metrics()),
          activityHeatmapProvider.overrideWith((ref, arg) async => const {}),
          agentsProvider.overrideWith((ref) async => const <AgentDescriptor>[]),
          metricsSnapshotsProvider.overrideWith(_NoMetrics.new),
          relayStatusProvider.overrideWith((ref) => Stream.value(null)),
          pendingRelaySwitchProvider.overrideWith((ref, id) async => null),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: PcDetailsScreen(deviceId: 'mac-1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text("Jorge's MacBook"), findsWidgets);
    expect(find.text('Time connected'), findsOneWidget);
    expect(find.text('Less'), findsOneWidget);
  });

  testWidgets("a PC's plan limits show on its own screen while it is connected",
      (tester) async {
    SharedPreferences.setMockInitialValues(const {});
    tester.view.physicalSize = const Size(1200, 3200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    Widget screen(String? connected) => ProviderScope(
          overrides: [
            trustedDevicesProvider.overrideWith(
              (ref) => Stream.value([_device('mac-1'), _device('mac-2')]),
            ),
            connectedDeviceProvider.overrideWith(
              (ref) =>
                  Stream.value(connected == null ? null : _device(connected)),
            ),
            bridgeStatusProvider.overrideWith((ref) async => null),
            connectedRouteProvider
                .overrideWith((ref) => Stream.value(ConnectionRoute.lan)),
            bridgeHomeProvider.overrideWith((ref) => Stream.value(null)),
            pcMetricsProvider.overrideWith((ref, id) async => _metrics()),
            activityHeatmapProvider.overrideWith((ref, arg) async => const {}),
            agentsProvider
                .overrideWith((ref) async => const <AgentDescriptor>[]),
            metricsSnapshotsProvider.overrideWith(_NoMetrics.new),
            usageStatsProvider.overrideWith(_NoUsage.new),
            relayStatusProvider.overrideWith((ref) => Stream.value(null)),
            pendingRelaySwitchProvider.overrideWith((ref, id) async => null),
          ],
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: PcDetailsScreen(deviceId: 'mac-1'),
          ),
        );

    await tester.pumpWidget(screen('mac-1'));
    await tester.pumpAndSettle();
    expect(find.byType(UsageSection), findsOneWidget);

    // Limits are read live from the connected PC: another PC's screen has
    // none to show.
    await tester.pumpWidget(Container());
    await tester.pumpWidget(screen('mac-2'));
    await tester.pumpAndSettle();
    expect(find.byType(UsageSection), findsNothing);
  });

  group('the header names how the phone reaches the PC', () {
    Widget screen(ConnectionRoute? route) => ProviderScope(
          overrides: [
            trustedDevicesProvider
                .overrideWith((ref) => Stream.value([_device('mac-1')])),
            connectedDeviceProvider
                .overrideWith((ref) => Stream.value(_device('mac-1'))),
            connectedRouteProvider.overrideWith((ref) => Stream.value(route)),
            bridgeStatusProvider.overrideWith((ref) async => null),
            bridgeHomeProvider.overrideWith((ref) => Stream.value(null)),
            pcMetricsProvider.overrideWith((ref, id) async => _metrics()),
            activityHeatmapProvider.overrideWith((ref, arg) async => const {}),
            agentsProvider
                .overrideWith((ref) async => const <AgentDescriptor>[]),
            metricsSnapshotsProvider.overrideWith(_NoMetrics.new),
            usageStatsProvider.overrideWith(_NoUsage.new),
            relayStatusProvider.overrideWith((ref) => Stream.value(null)),
            pendingRelaySwitchProvider.overrideWith((ref, id) async => null),
          ],
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: PcDetailsScreen(deviceId: 'mac-1'),
          ),
        );

    for (final (route, label, icon) in [
      (ConnectionRoute.lan, 'LAN', UxIcons.router),
      (ConnectionRoute.tailscale, 'Tailscale', UxIcons.shield),
      (ConnectionRoute.relay, 'Relay', UxIcons.cloud),
    ]) {
      testWidgets(label, (tester) async {
        SharedPreferences.setMockInitialValues(const {});
        tester.view.physicalSize = const Size(1200, 3200);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(screen(route));
        await tester.pumpAndSettle();

        final badge = find.byType(NeBadge);
        expect(
          find.descendant(of: badge, matching: find.text(label)),
          findsOneWidget,
        );
        expect(
          find.descendant(of: badge, matching: findUxIcon(icon)),
          findsOneWidget,
        );
        // Never the bridge's own relay link, read as this phone's route.
        expect(find.text('Direct'), findsNothing);
      });
    }
  });
}
