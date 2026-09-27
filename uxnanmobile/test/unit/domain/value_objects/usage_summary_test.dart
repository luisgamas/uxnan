import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/usage_summary.dart';

void main() {
  // The shape the bridge answers `usage/summary` with (shared `UsageSummary`).
  final wire = <String, dynamic>{
    'days': [
      {
        'day': '2026-09-24',
        'buckets': [
          {
            'agentId': 'claude-code',
            'model': 'claude-opus-5-5',
            'inputTokens': 2,
            'cachedInputTokens': 5000,
            'cacheWriteTokens': 1000,
            'outputTokens': 400,
            'reasoningTokens': 10,
            'costUsd': 0.045,
            'estimatedCostUsd': 0.045,
            'unpricedTokens': 0,
            'responses': 1,
          },
        ],
      },
    ],
    'agents': [
      {'agentId': 'claude-code', 'sessions': 2, 'status': 'ok'},
      {'agentId': 'opencode', 'sessions': 0, 'status': 'unreadable'},
    ],
  };

  test('parses the wire shape and writes it back unchanged', () {
    final summary = UsageSummary.fromJson(wire);
    final bucket = summary.days.single.buckets.single;
    expect(bucket.agentId, 'claude-code');
    expect(bucket.spend.tokens, 2 + 5000 + 1000 + 400);
    expect(bucket.spend.costUsd, 0.045);
    expect(summary.agents.last.readable, isFalse);
    expect(UsageSummary.fromJson(summary.toJson()), summary);
  });

  test('spend adds up, and unknown cost is never zero cost', () {
    const priced = UsageSpend(inputTokens: 10, costUsd: 1, responses: 1);
    const unpriced = UsageSpend(outputTokens: 5, unpricedTokens: 5);
    final sum = priced + unpriced;
    expect(sum.tokens, 15);
    expect(sum.responses, 1);
    expect(sum.unpriced, isFalse);
    expect(unpriced.unpriced, isTrue);
    // A free model billed $0 is priced, not unknown.
    expect(const UsageSpend(inputTokens: 3).unpriced, isFalse);
  });

  test('a malformed answer parses to empty lists, never a throw', () {
    final summary = UsageSummary.fromJson(const {'days': 'x', 'agents': null});
    expect(summary.days, isEmpty);
    expect(summary.agents, isEmpty);
  });
}
