import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/pc_details_screen.dart';

/// Skips the real `metrics/get` fetch (whose timeout timer would fail the
/// test); paired with an empty `agentsProvider` override for the agent section.
class _NoMetrics extends MetricsController {
  @override
  Future<Map<String, MetricsSnapshot>> build() async =>
      const <String, MetricsSnapshot>{};
}

TrustedDevice _device(String id) => TrustedDevice(
      macDeviceId: id,
      displayName: "Jorge's MacBook",
      macIdentityPublicKey: Uint8List(32),
      relayUrl: 'wss://relay.uxnan.dev',
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
}
