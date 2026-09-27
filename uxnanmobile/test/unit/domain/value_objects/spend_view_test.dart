import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/spend_view.dart';
import 'package:uxnan/domain/value_objects/usage_summary.dart';

UsageBucket _bucket(String agent, String model, UsageSpend spend) =>
    UsageBucket(agentId: agent, model: model, spend: spend);

void main() {
  final today = DateTime(2026, 9, 26, 15);
  final pc1 = UsageSummary(
    days: [
      UsageDay(
        day: '2026-09-26',
        buckets: [
          _bucket(
            'claude-code',
            'claude-opus-5-5',
            const UsageSpend(inputTokens: 100, costUsd: 3, responses: 2),
          ),
          _bucket(
            'codex',
            'gpt-6',
            const UsageSpend(inputTokens: 900, unpricedTokens: 900),
          ),
        ],
      ),
      // Out of a 7-day period.
      UsageDay(
        day: '2026-08-01',
        buckets: [
          _bucket('claude-code', 'm', const UsageSpend(costUsd: 50)),
        ],
      ),
    ],
    agents: const [],
  );
  final pc2 = UsageSummary(
    days: [
      UsageDay(
        day: '2026-09-25',
        buckets: [
          _bucket(
            'claude-code',
            'claude-opus-5-5',
            const UsageSpend(inputTokens: 50, costUsd: 1, responses: 1),
          ),
          _bucket('echo', 'echo', const UsageSpend(inputTokens: 5)),
        ],
      ),
    ],
    agents: const [],
  );

  test('every day of the period, oldest first, spent or not', () {
    final view = computeSpendView([pc1], 7, SpendMetric.cost, today: today);
    expect(view.days, hasLength(7));
    expect(view.days.first.day, DateTime(2026, 9, 20));
    expect(view.days.last.day, DateTime(2026, 9, 26));
    expect(view.days.last.byAgent['claude-code'], 3);
    // The August day is out of the period.
    expect(view.total.costUsd, 3);
  });

  test('PCs add up; agents keep their fixed order; models rank by value', () {
    final view =
        computeSpendView([pc1, pc2], 7, SpendMetric.cost, today: today);
    expect(view.agents.map((a) => a.agentId), ['codex', 'claude-code']);
    final claude = view.agents.last;
    expect(claude.spend.costUsd, 4);
    expect(claude.share, 1);
    expect(view.models.first.model, 'claude-opus-5-5');
    expect(view.models.first.spend.responses, 3);
  });

  test('the development echo agent is never counted', () {
    final view = computeSpendView([pc2], 7, SpendMetric.tokens, today: today);
    expect(view.agents.map((a) => a.agentId), ['claude-code']);
    expect(view.total.tokens, 50);
  });

  test('in tokens, an unpriced agent has its share', () {
    final view = computeSpendView([pc1], 7, SpendMetric.tokens, today: today);
    final codex = view.agents.first;
    expect(codex.agentId, 'codex');
    expect(codex.share, closeTo(0.9, 1e-9));
    expect(view.peak(), 1000);
    expect(view.peak(['claude-code']), 100);
  });

  test('a round ceiling close above the peak', () {
    expect(niceCeiling(0), 1);
    expect(niceCeiling(162), 200);
    expect(niceCeiling(240), 250);
    expect(niceCeiling(1000), 1000);
    expect(niceCeiling(0.07), closeTo(0.08, 1e-12));
  });

  test('periodDays crosses a month', () {
    expect(periodDays(3, DateTime(2026, 10)), [
      DateTime(2026, 9, 29),
      DateTime(2026, 9, 30),
      DateTime(2026, 10),
    ]);
  });
}
