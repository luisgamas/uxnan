import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/bridge_replica.dart';
import 'package:uxnan/application/services/session_title_follow_up.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// A bridge that answers `agent/sessions` from [answer], counting the asks.
class _Replica extends Fake implements BridgeReplica {
  _Replica(this.answer);

  AgentSessionList Function(int ask) answer;
  int asked = 0;

  @override
  Future<AgentSessionList> listAgentSessions(String cwd) async =>
      answer(asked++);
}

AgentSessionList _naming({bool pending = true, String? threadId}) =>
    AgentSessionList(
      sessions: [
        AgentSessionSummary(
          agentId: 'opencode',
          sessionId: 'o-1',
          cwd: '/app',
          updatedAgo: const Duration(minutes: 1),
          title: pending ? null : 'Named',
          titlePending: pending,
        ),
        if (threadId != null)
          AgentSessionSummary(
            agentId: 'codex',
            sessionId: 'c-1',
            cwd: '/app',
            updatedAgo: const Duration(minutes: 2),
            title: 'Already a conversation',
            threadId: threadId,
          ),
      ],
      unlisted: const [],
    );

ProviderContainer _sessionsContainer(_Replica replica) {
  final container = ProviderContainer(
    overrides: [
      bridgeSupportsAgentSessionsProvider.overrideWithValue(true),
      bridgeReplicaProvider.overrideWithValue(replica),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<void> _elapse(WidgetTester tester, Duration total) async {
  const step = Duration(seconds: 1);
  for (var t = Duration.zero; t < total; t += step) {
    await tester.pump(step);
  }
}

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
    container.listen(agentSessionsProvider('/app'), (_, __) {});
    final list = await container.read(agentSessionsProvider('/app').future);
    expect(list.sessions, isEmpty);
    expect(list.unlisted, isEmpty);
  });

  group("the folder's agent sessions follow the bridge naming them", () {
    testWidgets('a name that arrives later replaces the pending row', (
      tester,
    ) async {
      final replica = _Replica((ask) => _naming(pending: ask < 2));
      final container = _sessionsContainer(replica);
      final seen = <AgentSessionList>[];
      container.listen(
        agentSessionsProvider('/app'),
        (_, next) => next.whenData(seen.add),
        fireImmediately: true,
      );

      await _elapse(tester, const Duration(minutes: 1));

      expect(replica.asked, 3);
      expect(seen.last.sessions.single.title, 'Named');
      expect(seen.last.sessions.single.titlePending, isFalse);
    });

    testWidgets('leaves out sessions a conversation already continues', (
      tester,
    ) async {
      final replica = _Replica((_) => _naming(pending: false, threadId: 't1'));
      final container = _sessionsContainer(replica)
        ..listen(agentSessionsProvider('/app'), (_, __) {});

      await _elapse(tester, const Duration(seconds: 1));

      final list = container.read(agentSessionsProvider('/app')).value!;
      expect(list.sessions.map((s) => s.sessionId), ['o-1']);
    });

    testWidgets('is bounded, and asking again from outside starts it over', (
      tester,
    ) async {
      final replica = _Replica((_) => _naming());
      final container = _sessionsContainer(replica)
        ..listen(agentSessionsProvider('/app'), (_, __) {});

      await _elapse(tester, const Duration(minutes: 30));
      expect(replica.asked, 1 + kSessionTitleFollowUpRounds);

      container.invalidate(agentSessionsProvider('/app'));
      await _elapse(tester, const Duration(minutes: 30));
      expect(replica.asked, 2 * (1 + kSessionTitleFollowUpRounds));
    });

    testWidgets('stops asking when the last listener leaves', (tester) async {
      final replica = _Replica((_) => _naming());
      final container = _sessionsContainer(replica);
      final subscription = container.listen(
        agentSessionsProvider('/app'),
        (_, __) {},
      );

      await _elapse(tester, const Duration(seconds: 6));
      expect(replica.asked, 2);
      subscription.close();
      // Disposal is scheduled; let it happen, then see nothing more is asked.
      await _elapse(tester, const Duration(minutes: 5));
      expect(replica.asked, 2);
    });
  });
}
