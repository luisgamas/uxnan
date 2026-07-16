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
import 'package:uxnan/presentation/screens/profile/profile_screen.dart';

/// A metrics controller that skips the real `metrics/get` fetch (which would
/// leave a pending request-timeout timer) and yields no cached snapshots.
/// Paired with an empty `agentsProvider` override, this keeps the agent
/// section from starting real network requests in widget tests.
class _NoMetrics extends MetricsController {
  @override
  Future<Map<String, MetricsSnapshot>> build() async =>
      const <String, MetricsSnapshot>{};
}

ProfileMetrics _metrics() => ProfileMetrics(
      conversations: 12,
      agentsUsed: 3,
      modelsUsed: 4,
      messages: 340,
      gitActions: 21,
      sessions: 8,
      totalConnected: const Duration(hours: 37),
      longestSession: const Duration(hours: 3, minutes: 12),
      relaySessions: 3,
      directSessions: 5,
      byAgent: const [
        AgentUsage(agentId: 'claude-code', conversations: 6),
        AgentUsage(agentId: 'codex', conversations: 4),
        AgentUsage(agentId: 'opencode', conversations: 2),
      ],
      memberSince: DateTime(2026, 3),
      mostUsedTransport: ConnectionTransport.direct,
    );

void main() {
  testWidgets('ProfileScreen renders metrics + heatmap without crashing',
      (tester) async {
    // Profile name/avatar hydrate from SharedPreferences on first build.
    SharedPreferences.setMockInitialValues(const {});
    // A tall surface so the whole (lazily-built) list lays out on screen.
    tester.view.physicalSize = const Size(1200, 3200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          profileMetricsProvider.overrideWith((ref) async => _metrics()),
          trustedDevicesProvider.overrideWith((ref) => Stream.value(const [])),
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
          activityHeatmapProvider.overrideWith(
            (ref, arg) async => {
              DateTime.utc(2026, 7, 2): 3,
              DateTime.utc(2026, 7, 4): 1,
            },
          ),
          agentsProvider.overrideWith((ref) async => const <AgentDescriptor>[]),
          metricsSnapshotsProvider.overrideWith(_NoMetrics.new),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: ProfileScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Rendered without the earlier infinite-height layout crash: unique
    // stat labels/values and the heatmap legend are present.
    expect(find.text('Agents used'), findsOneWidget);
    expect(find.text('340'), findsOneWidget);
    // The heatmap legend renders (the unified agent-activity section).
    expect(find.text('Less'), findsOneWidget);
  });

  testWidgets(
    'Backup: cancelling the export passphrase dialog does not crash',
    (tester) async {
      SharedPreferences.setMockInitialValues(const {});
      tester.view.physicalSize = const Size(1200, 3200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final device = TrustedDevice(
        macDeviceId: 'pc-1',
        displayName: 'My PC',
        macIdentityPublicKey: Uint8List(32),
        relayUrl: 'wss://relay.example',
        sessionId: 'sess-1',
        pairedAt: DateTime(2026, 3),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            profileMetricsProvider.overrideWith((ref) async => _metrics()),
            trustedDevicesProvider
                .overrideWith((ref) => Stream.value([device])),
            connectedDeviceProvider.overrideWith((ref) => Stream.value(device)),
            activityHeatmapProvider.overrideWith((ref, arg) async => const {}),
            agentsProvider
                .overrideWith((ref) async => const <AgentDescriptor>[]),
            metricsSnapshotsProvider.overrideWith(_NoMetrics.new),
          ],
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: ProfileScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Open the export passphrase dialog (the Export button is enabled while
      // a PC is connected).
      final exportButton = find.text('Export');
      await tester.ensureVisible(exportButton);
      await tester.tap(exportButton);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);

      // Cancelling must dismiss it cleanly — previously the dialog's controller
      // was disposed too early and threw "used after being disposed" during the
      // close animation.
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    },
  );
}
