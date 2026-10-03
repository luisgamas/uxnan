import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/action_outbox.dart';
import 'package:uxnan/application/managers/relay_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/value_objects/pending_action.dart';
import 'package:uxnan/domain/value_objects/relay_status.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

import '../../support/relay_fakes.dart';

void main() {
  late FakeRelayBridge bridge;
  late StreamController<DomainEvent> events;
  late StreamController<ConnectionPhase> phases;
  late InMemoryActionRepository actions;
  late DateTime now;
  late String? connectedPc;
  late RelayManager manager;

  setUp(() {
    bridge = FakeRelayBridge(relayStatusJson());
    events = StreamController<DomainEvent>.broadcast();
    phases = StreamController<ConnectionPhase>.broadcast();
    actions = InMemoryActionRepository();
    now = DateTime(2026, 10, 2, 12);
    connectedPc = 'pc-1';
    manager = RelayManager(
      sendRequest: bridge.send,
      sendCloudflareRequest: bridge.sendViaCloudflare,
      domainEvents: events.stream,
      connectionPhases: phases.stream,
      currentDeviceId: () => connectedPc,
      outbox: ActionOutbox(repository: actions, clock: () => now),
    );
  });

  tearDown(() async {
    await manager.dispose();
    await events.close();
    await phases.close();
  });

  Future<void> connect() async {
    phases.add(ConnectionPhase.connected);
    await pumpEventQueue();
  }

  test('reads the status on connect and forgets it on disconnect', () async {
    await connect();
    expect(bridge.requests.single.$1, 'relay/status');
    expect(manager.status?.state, RelayConnectionState.connected);

    phases.add(ConnectionPhase.reconnecting);
    await pumpEventQueue();
    expect(manager.status, isNull);
  });

  test('a stream/relay/updated replaces the mirror', () async {
    events.add(
      RelayUpdatedEvent(
        status: relayStatusJson(state: 'error', lastError: 'Token revoked'),
      ),
    );
    await pumpEventQueue();
    expect(manager.status?.state, RelayConnectionState.error);
    expect(manager.status?.lastError, 'Token revoked');
  });

  test('setup asks the bridge to deploy with the long wait', () async {
    final status = await manager.setup(
      accountId: 'acc',
      apiToken: 'secret',
      remember: true,
    );
    expect(status?.endpoint?.routingId, testRoutingId);
    expect(bridge.viaCloudflare, ['relay/setup']);
    expect(bridge.requests.single.$2, {
      'provider': 'cloudflare',
      'accountId': 'acc',
      'apiToken': 'secret',
      'remember': true,
    });
  });

  test('update and deleting the Worker wait on Cloudflare; rotate does not',
      () async {
    await manager.update(apiToken: 't', remember: false);
    await manager.rotate();
    await manager.remove();
    await manager.remove(deleteWorker: true, apiToken: 't');
    expect(bridge.viaCloudflare, ['relay/update', 'relay/remove']);
    expect(bridge.requests.map((r) => r.$1), [
      'relay/update',
      'relay/rotate',
      'relay/remove',
      'relay/remove',
    ]);
    expect(bridge.requests[0].$2, {'apiToken': 't', 'remember': false});
    expect(bridge.requests[2].$2, {'deleteWorker': false});
    expect(bridge.requests[3].$2, {'deleteWorker': true, 'apiToken': 't'});
  });

  test("a refusal comes back as the bridge's error, word for word", () async {
    bridge.refusals['relay/rotate'] = 'The relay is not set up.';
    await expectLater(
      manager.rotate(),
      throwsA(
        isA<RpcError>()
            .having((e) => e.message, 'message', 'The relay is not set up.'),
      ),
    );
  });

  test('the switch is sent and applied while its PC is connected', () async {
    await connect();
    bridge.status = relayStatusJson(enabled: false, state: 'off');
    final outcome = await manager.setEnabled(deviceId: 'pc-1', enabled: false);
    expect(outcome, RelaySwitchOutcome.applied);
    expect(bridge.requests.last.$1, 'relay/set');
    expect(bridge.requests.last.$2, {'enabled': false});
    expect(manager.status?.endpoint?.enabled, isFalse);
    expect(await manager.pendingEnabled('pc-1'), isNull);
  });

  test('a refused switch is not kept: there is nothing to retry', () async {
    await connect();
    bridge.refusals['relay/set'] = 'No relay to switch.';
    await expectLater(
      manager.setEnabled(deviceId: 'pc-1', enabled: true),
      throwsA(isA<RpcError>()),
    );
    expect(await manager.pendingEnabled('pc-1'), isNull);
  });

  test('the switch is kept while its PC is out of reach, latest wins',
      () async {
    // Not connected at all.
    expect(
      await manager.setEnabled(deviceId: 'pc-1', enabled: false),
      RelaySwitchOutcome.kept,
    );
    expect(
      await manager.setEnabled(deviceId: 'pc-1', enabled: true),
      RelaySwitchOutcome.kept,
    );
    expect(bridge.requests, isEmpty);
    expect(await manager.pendingEnabled('pc-1'), isTrue);
    final kept = await actions.pendingActions('pc-1');
    expect(kept.single.kind, PendingActionKind.setRelay);
    expect(kept.single.decidedAt, now);
  });

  test('a switch for a PC other than the connected one is kept for it',
      () async {
    await connect();
    connectedPc = 'pc-2';
    final outcome = await manager.setEnabled(deviceId: 'pc-1', enabled: false);
    expect(outcome, RelaySwitchOutcome.kept);
    expect(bridge.requests.map((r) => r.$1), isNot(contains('relay/set')));
    expect(await manager.pendingEnabled('pc-1'), isFalse);
    expect(await manager.pendingEnabled('pc-2'), isNull);
  });

  test('a switch lost on the way is kept', () async {
    await connect();
    bridge.lost.add('relay/set');
    final outcome = await manager.setEnabled(deviceId: 'pc-1', enabled: false);
    expect(outcome, RelaySwitchOutcome.kept);
    expect(await manager.pendingEnabled('pc-1'), isFalse);
  });
}
