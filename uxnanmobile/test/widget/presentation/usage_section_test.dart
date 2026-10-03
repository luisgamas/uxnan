import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/usage_section.dart';

final _pc = TrustedDevice(
  macDeviceId: 'pc-1',
  displayName: 'Studio Mac',
  macIdentityPublicKey: Uint8List(32),
  sessionId: 's',
  pairedAt: DateTime(2026, 3),
);

/// Plan limits as the bridge answers them, and a redeem that records its
/// call the way `usage/redeemReset` would be sent.
class _Usage extends UsageStatsController {
  final redeemed = <({UsageProvider provider, String attempt, String? id})>[];

  @override
  Future<List<ProviderUsage>> build() async => [
        ProviderUsage(
          provider: UsageProvider.claude,
          status: UsageStatus.ok,
          windows: [
            UsageWindow(
              id: 'session',
              label: 'Session',
              usedPercent: 72,
              windowMinutes: 300,
              resetsAt: DateTime.now().add(const Duration(hours: 2)),
            ),
          ],
          updatedAt: DateTime.now(),
          account: const UsageAccount(
            plan: 'Max',
            accountType: AccountType.subscription,
          ),
        ),
        ProviderUsage(
          provider: UsageProvider.codex,
          status: UsageStatus.ok,
          windows: const [],
          updatedAt: DateTime.now(),
          resetCredits: ResetCredits(
            available: 2,
            entries: [
              ResetCreditEntry(id: 'soon', expiresAt: DateTime(2026, 10, 3)),
              ResetCreditEntry(id: 'late', expiresAt: DateTime(2026, 11, 3)),
            ],
          ),
        ),
        ProviderUsage(
          provider: UsageProvider.grok,
          status: UsageStatus.notInstalled,
          windows: const [],
          updatedAt: DateTime.now(),
        ),
      ];

  @override
  Future<void> redeemReset(
    UsageProvider provider, {
    required String attempt,
    String? creditId,
  }) async {
    redeemed.add((provider: provider, attempt: attempt, id: creditId));
  }
}

Widget _wrap(_Usage usage) => ProviderScope(
      overrides: [
        connectedDeviceProvider.overrideWith((ref) => Stream.value(_pc)),
        usageStatsProvider.overrideWith(() => usage),
      ],
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: SingleChildScrollView(child: UsageSection())),
      ),
    );

void main() {
  testWidgets('says which PC answered, the pace, and hides what is absent', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(_Usage()));
    await tester.pumpAndSettle();
    expect(find.text('As Studio Mac reads them now'), findsOneWidget);
    expect(find.textContaining('At this pace you hit the limit in'), findsOne);
    expect(find.text('Max'), findsOneWidget);
    expect(find.text('Subscription'), findsOneWidget);
    expect(find.text('Grok'), findsNothing);
  });

  testWidgets('redeems the soonest-expiring reset after a confirmation', (
    tester,
  ) async {
    final usage = _Usage();
    await tester.pumpWidget(_wrap(usage));
    await tester.pumpAndSettle();
    expect(find.textContaining('2 resets available'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Redeem'));
    await tester.pumpAndSettle();
    expect(find.text('Redeem a reset?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Redeem').last);
    await tester.pumpAndSettle();

    expect(usage.redeemed, hasLength(1));
    expect(usage.redeemed.single.provider, UsageProvider.codex);
    expect(usage.redeemed.single.id, 'soon');
    expect(usage.redeemed.single.attempt, isNotEmpty);
  });

  testWidgets('hidden while no PC is connected', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: UsageSection()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Plan limits'), findsNothing);
  });
}
