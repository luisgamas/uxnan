import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/bridge_status.dart';
import 'package:uxnan/domain/value_objects/bridge_update.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

const _available = BridgeUpdate(
  version: '0.0.28',
  latestVersion: '0.0.29',
  available: true,
  canApply: true,
  phase: BridgeUpdatePhase.idle,
);

ProviderContainer _container({
  BridgeStatus? status,
  BridgeUpdate? live,
}) {
  final container = ProviderContainer(
    overrides: [
      bridgeStatusProvider.overrideWith((ref) async => status),
      bridgeUpdateStreamProvider.overrideWith((ref) => Stream.value(live)),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<BridgeUpdateNotice?> _notice(ProviderContainer container) async {
  // Riverpod 3 drops a provider nobody listens to, even mid-load.
  container
    ..listen(bridgeUpdateProvider, (_, __) {})
    ..listen(bridgeUpdateStreamProvider, (_, __) {});
  await container.read(bridgeStatusProvider.future);
  await container.read(bridgeUpdateStreamProvider.future);
  return container.read(bridgeUpdateProvider);
}

void main() {
  test('a published update is shown until dismissed', () async {
    final container = _container(
      status: const BridgeStatus(
        relayConnected: false,
        version: '0.0.28',
        update: _available,
      ),
    );
    final notice = await _notice(container);
    expect(notice?.update?.latestVersion, '0.0.29');
    container.read(bridgeUpdateDismissalProvider.notifier).dismiss(notice?.key);
    expect(container.read(bridgeUpdateProvider), isNull);
  });

  test('a bridge that predates updating itself asks to be updated on the PC',
      () async {
    final container = _container(
      status: const BridgeStatus(relayConnected: false, version: '0.0.28'),
    );
    final notice = await _notice(container);
    expect(notice?.update, isNull);
    expect(notice?.key, 'from:0.0.28');
  });

  test("the bridge's latest word wins over its status, and updating stays",
      () async {
    final container = _container(
      status: const BridgeStatus(
        relayConnected: false,
        version: '0.0.28',
        update: _available,
      ),
      live: const BridgeUpdate(
        version: '0.0.28',
        latestVersion: '0.0.29',
        available: true,
        canApply: true,
        phase: BridgeUpdatePhase.updating,
        targetVersion: '0.0.29',
      ),
    );
    final notice = await _notice(container);
    expect(notice?.update?.phase, BridgeUpdatePhase.updating);
    container.read(bridgeUpdateDismissalProvider.notifier).dismiss('updating');
    expect(container.read(bridgeUpdateProvider), isNotNull);
  });

  test('an up-to-date bridge, or no PC, says nothing', () async {
    expect(
      await _notice(
        _container(
          status: const BridgeStatus(
            relayConnected: false,
            version: '0.0.29',
            update: BridgeUpdate(
              version: '0.0.29',
              available: false,
              canApply: true,
              phase: BridgeUpdatePhase.idle,
            ),
          ),
        ),
      ),
      isNull,
    );
    expect(await _notice(_container()), isNull);
  });
}
