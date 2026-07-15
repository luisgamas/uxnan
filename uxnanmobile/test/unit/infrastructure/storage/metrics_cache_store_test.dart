import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/infrastructure/storage/metrics_cache_store.dart';

MetricsSnapshot _snap(String deviceId, {int conversations = 1}) {
  return MetricsSnapshot(
    deviceId: deviceId,
    conversations: conversations,
    agentsUsed: 1,
    modelsUsed: 1,
    messages: 2,
    gitActions: 0,
    sessions: 1,
    totalConnectedMs: 1000,
    longestSessionMs: 1000,
    relaySessions: 1,
    directSessions: 0,
    byAgent: const [MetricsAgentUsage(agentId: 'codex', conversations: 1)],
    activity: const [
      MetricsActivityDay(day: 1000, conversations: 1, messages: 2, work: 0),
    ],
    memberSince: 500,
  );
}

void main() {
  group('MetricsCacheStore', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('readAll on an empty store is an empty map', () async {
      expect(await MetricsCacheStore().readAll(), isEmpty);
    });

    test('writeOne stores snapshots keyed by deviceId; readAll returns them',
        () async {
      final store = MetricsCacheStore();
      await store.writeOne(_snap('pc-1', conversations: 3));
      await store.writeOne(_snap('pc-2', conversations: 7));

      final all = await store.readAll();
      expect(all.keys, containsAll(<String>['pc-1', 'pc-2']));
      expect(all['pc-1']!.conversations, 3);
      expect(all['pc-2']!.conversations, 7);
      // Round-trips the full value (Equatable equality).
      expect(all['pc-1'], _snap('pc-1', conversations: 3));
    });

    test('writeOne with the same deviceId replaces the prior snapshot',
        () async {
      final store = MetricsCacheStore();
      await store.writeOne(_snap('pc-1'));
      await store.writeOne(_snap('pc-1', conversations: 9));

      final all = await store.readAll();
      expect(all.length, 1);
      expect(all['pc-1']!.conversations, 9);
    });

    test('cached snapshots persist across store instances (app restart)',
        () async {
      await MetricsCacheStore().writeOne(_snap('pc-1', conversations: 4));
      // A brand-new store (what the next app launch creates) reads it back.
      final all = await MetricsCacheStore().readAll();
      expect(all['pc-1']!.conversations, 4);
    });
  });
}
