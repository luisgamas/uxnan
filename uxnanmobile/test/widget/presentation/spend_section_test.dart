import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/usage_summary.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/spend_section.dart';

String _today() {
  final d = DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}

class _Summaries extends UsageSummariesController {
  _Summaries(this._value);

  final Map<String, UsageSummary> _value;

  @override
  Future<Map<String, UsageSummary>> build() async => _value;
}

Map<String, UsageSummary> _twoPcs() => {
      'pc-1': UsageSummary(
        days: [
          UsageDay(
            day: _today(),
            buckets: const [
              UsageBucket(
                agentId: 'claude-code',
                model: 'claude-opus-5-5',
                spend: UsageSpend(
                  inputTokens: 1000,
                  outputTokens: 500,
                  costUsd: 12.5,
                  estimatedCostUsd: 12.5,
                  responses: 3,
                ),
              ),
              UsageBucket(
                agentId: 'codex',
                model: 'gpt-6',
                spend: UsageSpend(
                  inputTokens: 4000,
                  outputTokens: 1000,
                  unpricedTokens: 5000,
                  responses: 2,
                ),
              ),
            ],
          ),
        ],
        agents: const [],
      ),
      'pc-2': UsageSummary(
        days: [
          UsageDay(
            day: _today(),
            buckets: const [
              UsageBucket(
                agentId: 'claude-code',
                model: 'claude-sonnet-5',
                spend: UsageSpend(inputTokens: 100, costUsd: 2.5, responses: 1),
              ),
            ],
          ),
        ],
        agents: const [],
      ),
    };

Widget _wrap(Map<String, UsageSummary> value, {String? deviceId}) =>
    ProviderScope(
      overrides: [
        usageSummariesProvider.overrideWith(() => _Summaries(value)),
      ],
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SingleChildScrollView(child: SpendSection(deviceId: deviceId)),
        ),
      ),
    );

void main() {
  testWidgets(r'adds every PC, and never shows an unpriced agent as $0', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 2400);
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(_wrap(_twoPcs()));
    await tester.pumpAndSettle();

    // The headline (and the claude-only legend total and the scale's top).
    expect(find.text(r'$15.00'), findsWidgets);
    expect(find.text('6 responses'), findsOneWidget);
    // Codex spent tokens at no known price.
    expect(find.text('No price'), findsWidgets);
    expect(find.text('5K'), findsWidgets);
  });

  testWidgets('one PC alone', (tester) async {
    tester.view.physicalSize = const Size(800, 2400);
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(_wrap(_twoPcs(), deviceId: 'pc-2'));
    await tester.pumpAndSettle();
    expect(find.text(r'$2.50'), findsWidgets);
    expect(find.text('Codex'), findsNothing);
  });

  testWidgets('focusing an agent follows it, in tokens when it has no price', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 2400);
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(_wrap(_twoPcs()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Codex'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Codex · Tokens — no known price'), findsOne);
    // The models follow the focus.
    expect(find.text('claude-opus-5-5'), findsNothing);

    await tester.tap(find.text('Codex'));
    await tester.pumpAndSettle();
    expect(find.text('claude-opus-5-5'), findsOneWidget);
  });

  testWidgets('says so when nothing is known', (tester) async {
    await tester.pumpWidget(_wrap(const {}));
    await tester.pumpAndSettle();
    expect(find.textContaining('Connect to a PC'), findsOneWidget);
  });

  testWidgets('says so when nothing was spent', (tester) async {
    await tester.pumpWidget(
      _wrap(const {'pc-1': UsageSummary(days: [], agents: [])}),
    );
    await tester.pumpAndSettle();
    expect(find.text('Nothing spent in this period.'), findsOneWidget);
  });
}
