import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/application/coordinators/session_coordinator.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/storage/usage_summary_cache_store.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// Answers requests the way the bridge does (shapes from `shared/`), and
/// records what was asked.
class _Bridge implements SessionCoordinator {
  _Bridge(this.answer);

  final RpcMessage Function(String method, Map<String, dynamic>? params) answer;
  final asked = <(String, Map<String, dynamic>?)>[];

  @override
  Future<RpcMessage> sendRequest(
    String method, [
    Map<String, dynamic>? params,
  ]) async {
    asked.add((method, params));
    return answer(method, params);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final _pc = TrustedDevice(
  macDeviceId: 'pc-1',
  displayName: 'Studio Mac',
  macIdentityPublicKey: Uint8List(32),
  relayUrl: 'wss://relay.example',
  sessionId: 's',
  pairedAt: DateTime(2026, 3),
);

ProviderContainer _container(_Bridge bridge, {TrustedDevice? connected}) {
  final container = ProviderContainer(
    overrides: [
      sessionCoordinatorProvider.overrideWithValue(bridge),
      connectedDeviceProvider.overrideWith((ref) => Stream.value(connected)),
    ],
  );
  addTearDown(container.dispose);
  // Held, as a screen holds them, so they neither dispose nor restart.
  container
    ..listen(connectedDeviceProvider, (_, __) {})
    ..listen(usageSummariesProvider, (_, __) {})
    ..listen(usageStatsProvider, (_, __) {})
    ..listen(usageRefreshIntervalProvider, (_, __) {});
  return container;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(const {}));

  test('asks the connected PC for 90 days of spend and caches it by PC',
      () async {
    final bridge = _Bridge(
      (method, params) => RpcMessage.response(
        id: '1',
        result: const {
          'days': [
            {
              'day': '2026-09-26',
              'buckets': [
                {
                  'agentId': 'codex',
                  'model': 'gpt-6',
                  'inputTokens': 10,
                  'cachedInputTokens': 0,
                  'cacheWriteTokens': 0,
                  'outputTokens': 2,
                  'reasoningTokens': 0,
                  'costUsd': 0,
                  'estimatedCostUsd': 0,
                  'unpricedTokens': 12,
                  'responses': 1,
                },
              ],
            },
          ],
          'agents': [
            {'agentId': 'codex', 'sessions': 1, 'status': 'ok'},
          ],
        },
      ),
    );
    final container = _container(bridge, connected: _pc);
    await container.read(connectedDeviceProvider.future);
    final all = await container.read(usageSummariesProvider.future);

    expect(bridge.asked.single.$1, 'usage/summary');
    expect(bridge.asked.single.$2, {'days': 90});
    expect(all['pc-1']!.days.single.buckets.single.spend.unpricedTokens, 12);
    expect((await UsageSummaryCacheStore().readAll()).keys, ['pc-1']);
  });

  test('offline, or a bridge without the method: the cache stands', () async {
    final bridge = _Bridge(
      (method, params) => RpcMessage.response(
        id: '1',
        error: const RpcError(code: -32601, message: 'Method not found'),
      ),
    );
    final container = _container(bridge, connected: _pc);
    await container.read(connectedDeviceProvider.future);
    expect(await container.read(usageSummariesProvider.future), isEmpty);

    final offline = _container(_Bridge((_, __) => throw StateError('never')));
    await offline.read(connectedDeviceProvider.future);
    expect(await offline.read(usageSummariesProvider.future), isEmpty);
  });

  test('redeems a reset with the attempt key and takes the fresh usage',
      () async {
    final bridge = _Bridge((method, params) {
      if (method == 'agent/usageStats') {
        return RpcMessage.response(
          id: '1',
          result: const {
            'usage': [
              {
                'provider': 'codex',
                'status': 'ok',
                'windows': [
                  {'id': 'monthly', 'label': 'Monthly', 'usedPercent': 75},
                ],
                'updatedAt': 1,
                'resetCredits': {'available': 1},
              },
            ],
          },
        );
      }
      return RpcMessage.response(
        id: '2',
        result: const {
          'provider': 'codex',
          'status': 'ok',
          'windows': [
            {'id': 'monthly', 'label': 'Monthly', 'usedPercent': 0},
          ],
          'updatedAt': 2,
        },
      );
    });
    final container = _container(bridge, connected: _pc);
    await container.read(connectedDeviceProvider.future);
    await container.read(usageStatsProvider.future);

    await container
        .read(usageStatsProvider.notifier)
        .redeemReset(UsageProvider.codex, attempt: 'try-1', creditId: 'c1');

    final redeem = bridge.asked.last;
    expect(redeem.$1, 'usage/redeemReset');
    expect(redeem.$2, {
      'provider': 'codex',
      'idempotencyKey': 'try-1',
      'creditId': 'c1',
    });
    final now = container.read(usageStatsProvider).value!;
    expect(now.single.windows.single.usedPercent, 0);
  });

  test('a refused redeem says why', () async {
    final bridge = _Bridge((method, params) {
      if (method == 'agent/usageStats') {
        return RpcMessage.response(
          id: '1',
          result: const {'usage': <Object>[]},
        );
      }
      return RpcMessage.response(
        id: '2',
        error: const RpcError(code: -32000, message: 'no reset left'),
      );
    });
    final container = _container(bridge, connected: _pc);
    await container.read(connectedDeviceProvider.future);
    await container.read(usageStatsProvider.future);
    await expectLater(
      container
          .read(usageStatsProvider.notifier)
          .redeemReset(UsageProvider.codex, attempt: 'a'),
      throwsA(
        isA<UsageRedeemException>()
            .having((e) => e.message, 'message', 'no reset left'),
      ),
    );
  });
}
