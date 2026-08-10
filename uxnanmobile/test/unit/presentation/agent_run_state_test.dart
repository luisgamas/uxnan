import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/auth_status.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';
import 'package:uxnan/presentation/providers/agent_run_state_provider.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// The derivation is the whole feature: the glyph is only as good as the state
/// behind it, and every input here can be true at the same time as another. So
/// these cases are mostly about **precedence** — which truth wins when two
/// compete — because that is what decides whether the row earns a glance.
/// One thread holding on one unanswered question.
const Map<String, Set<String>> _pending = {
  't1': {'approval-1'},
};

void main() {
  const id = 't1';

  Thread thread({
    ThreadStatus status = ThreadStatus.active,
    DateTime? lastActivity,
  }) =>
      Thread(
        id: id,
        title: 'A thread',
        agentId: 'claude-code',
        syncState: ThreadSyncState.synced,
        status: status,
        lastActivity: lastActivity,
      );

  ProviderContainer harness({
    ThreadActivity activity = ThreadActivity.idle,
    bool awaiting = false,
    bool requiresLogin = false,
    ThreadQueueState? queue,
    bool unread = false,
    Thread? withThread,
  }) {
    final container = ProviderContainer(
      overrides: [
        threadsProvider.overrideWith(
          (ref) => Stream.value([withThread ?? thread()]),
        ),
        threadActivityProvider.overrideWith(
          (ref) => Stream.value({id: activity}),
        ),
        awaitingInputProvider.overrideWith(
          (ref) => Stream.value(awaiting ? _pending : const {}),
        ),
        threadQueuesProvider.overrideWith(
          (ref) => Stream.value(queue == null ? {} : {id: queue}),
        ),
        unreadThreadsProvider.overrideWith(
          (ref) => Stream.value(unread ? {id} : <String>{}),
        ),
        authStatusProvider.overrideWith(
          (ref, agentId) async => AuthStatus(
            agentId: agentId,
            requiresLogin: requiresLogin,
            loginInProgress: false,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  /// Reads the state once every seeded stream has delivered.
  Future<AgentRunStatus> read(ProviderContainer c) async {
    c.listen(agentRunStatusProvider(id), (_, __) {});
    await c.read(threadsProvider.future);
    await c.read(awaitingInputProvider.future);
    await c.read(threadActivityProvider.future);
    await c.read(threadQueuesProvider.future);
    await c.read(unreadThreadsProvider.future);
    await c.read(authStatusProvider('claude-code').future);
    return c.read(agentRunStatusProvider(id));
  }

  test('a quiet thread is idle', () async {
    expect((await read(harness())).state, AgentRunState.idle);
  });

  test('a turn in flight is working', () async {
    final s = await read(harness(activity: ThreadActivity.running));
    expect(s.state, AgentRunState.working);
  });

  test('an unread reply on a finished turn is done', () async {
    expect((await read(harness(unread: true))).state, AgentRunState.done);
  });

  test('a pending question outranks the turn that is still running', () async {
    // The agent asked and stopped. It is technically mid-turn, but what the
    // user needs to know is that it is on THEM.
    final s = await read(
      harness(awaiting: true, activity: ThreadActivity.running),
    );
    expect(s.state, AgentRunState.waiting);
  });

  test('a signed-out agent is blocked even while idle', () async {
    final s = await read(harness(requiresLogin: true));
    expect(s.state, AgentRunState.blocked);
  });

  test('being signed out does not block an archived thread', () async {
    final s = await read(
      harness(
        requiresLogin: true,
        withThread: thread(status: ThreadStatus.archived),
      ),
    );
    expect(s.state, AgentRunState.idle);
  });

  test('a held queue blocks only while something is still queued', () async {
    final held = await read(
      harness(
        queue: const ThreadQueueState(turnIds: ['q1'], paused: true),
      ),
    );
    expect(held.state, AgentRunState.blocked);

    final drained = await read(
      harness(queue: const ThreadQueueState(paused: true)),
    );
    expect(
      drained.state,
      AgentRunState.idle,
      reason: 'a paused-but-empty queue holds nothing back',
    );
  });

  test('being asked outranks being blocked', () async {
    final s = await read(harness(awaiting: true, requiresLogin: true));
    expect(s.state, AgentRunState.waiting);
  });

  group('modifiers ride alongside the state, they do not replace it', () {
    test('an error tints whatever the agent is doing', () async {
      final s = await read(harness(activity: ThreadActivity.error));
      expect(s.errored, isTrue);
      expect(s.state, AgentRunState.idle);
    });

    test('only a long-quiet WORKING claim goes stale', () async {
      final old = DateTime.now().subtract(kAgentStaleAfter * 2);
      final working = await read(
        harness(
          activity: ThreadActivity.running,
          withThread: thread(lastActivity: old),
        ),
      );
      expect(working.stale, isTrue, reason: 'running for far too long');

      final fresh = await read(
        harness(
          activity: ThreadActivity.running,
          withThread: thread(lastActivity: DateTime.now()),
        ),
      );
      expect(fresh.stale, isFalse);

      // An idle thread untouched for a week is not "stale" — it is just idle,
      // and dimming it would say something is wrong when nothing is.
      final quiet = await read(harness(withThread: thread(lastActivity: old)));
      expect(quiet.stale, isFalse);
    });
  });
}
