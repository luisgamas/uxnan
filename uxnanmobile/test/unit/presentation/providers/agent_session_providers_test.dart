import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

void main() {
  test('a conversation is held when a terminal holds the session it continues',
      () async {
    const hold = AgentSessionHold(
      agentId: 'codex',
      sessionId: 'c-1',
      holderName: 'Studio',
      busy: false,
      threadId: 'th-1',
    );
    final container = ProviderContainer(
      overrides: [
        agentSessionHoldsProvider.overrideWith(
          (ref) => Stream.value({hold.key: hold}),
        ),
      ],
    );
    addTearDown(container.dispose);
    container.listen(agentSessionHoldsProvider, (_, __) {});
    await container.read(agentSessionHoldsProvider.future);
    expect(container.read(threadHoldProvider('th-1')), hold);
    expect(container.read(threadHoldProvider('th-2')), isNull);
  });

  test('an older bridge offers no sessions to pick up', () async {
    final container = ProviderContainer(
      overrides: [
        bridgeSupportsAgentSessionsProvider.overrideWithValue(false),
      ],
    );
    addTearDown(container.dispose);
    final list = await container.read(agentSessionsProvider('/app').future);
    expect(list.sessions, isEmpty);
    expect(list.unlisted, isEmpty);
  });
}
