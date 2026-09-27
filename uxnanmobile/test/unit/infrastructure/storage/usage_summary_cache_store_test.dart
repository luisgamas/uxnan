import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/usage_summary.dart';
import 'package:uxnan/infrastructure/storage/usage_summary_cache_store.dart';

void main() {
  const summary = UsageSummary(
    days: [
      UsageDay(
        day: '2026-09-26',
        buckets: [
          UsageBucket(
            agentId: 'codex',
            model: 'gpt-6',
            spend: UsageSpend(inputTokens: 7, unpricedTokens: 7, responses: 1),
          ),
        ],
      ),
    ],
    agents: [UsageAgentSource(agentId: 'codex', sessions: 1)],
  );

  test("keeps one summary per PC, replacing a PC's older one", () async {
    SharedPreferences.setMockInitialValues(const {});
    final store = UsageSummaryCacheStore();
    expect(await store.readAll(), isEmpty);
    await store.writeOne('pc-1', summary);
    await store.writeOne('pc-2', const UsageSummary(days: [], agents: []));
    await store.writeOne('pc-1', summary);
    final all = await store.readAll();
    expect(all.keys, unorderedEquals(['pc-1', 'pc-2']));
    expect(all['pc-1'], summary);
  });

  test('a corrupt value reads as nothing cached', () async {
    SharedPreferences.setMockInitialValues(
      const {'uxnan.usage.summaries': '{not json'},
    );
    expect(await UsageSummaryCacheStore().readAll(), isEmpty);
  });
}
