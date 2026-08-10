import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// A thread's agent state, plus the two modifiers that colour it.
///
/// [errored] and [stale] are deliberately NOT states: an agent can be working
/// *and* stale, and a thread's last turn can have failed while it sits idle.
/// Folding them into the enum would force a choice the UI does not have to
/// make.
typedef AgentRunStatus = ({
  AgentRunState state,
  bool errored,
  bool stale,
});

/// How long a thread may claim to be working before the claim is treated as
/// suspect. Matches the desktop's staleness threshold, for the same reason: a
/// turn that has been "running" for half an hour is almost always an orphan
/// left behind by a dropped connection, and dimming it is more honest than
/// showing a confident spinner.
const Duration kAgentStaleAfter = Duration(minutes: 30);

/// The live state of one thread's agent.
///
/// Priority, highest first — the order encodes what deserves the user's eye:
///
/// 1. **waiting** — the agent asked and stopped; nothing moves until you
///    answer.
/// 2. **blocked** — held by a sign-in or a paused queue: it needs an action,
///    not an answer.
/// 3. **working** — a turn is in flight.
/// 4. **done** — the last turn finished and its reply is unread.
/// 5. **idle** — everything else.
///
/// Every input is already in memory, so this is cheap enough to watch from
/// every row of a long list.
final agentRunStatusProvider =
    Provider.family<AgentRunStatus, String>((ref, threadId) {
  final activity = ref.watch(threadActivityForProvider(threadId));
  final errored = activity == ThreadActivity.error;

  // The agent asked something and is holding the turn. Tracked per thread by
  // the manager as the blocks arrive, so this is just as true for a thread the
  // user has never opened — which is the whole point of showing it in a list.
  // FOR-DEV: exact for a thread this phone has streamed or resynced, and
  // in-memory only — after a restart one that asked before the app closed reads
  // as `working` until the next `turn/list` replays its blocks. Degrading to
  // `working` is deliberate: it never claims a `waiting` that isn't there.
  // Making it exact needs the bridge to say so (a `stream/thread/state`
  // notification or a field on `thread/list`) — see FOR-DEV.md.
  final awaiting = ref.watch(threadAwaitingInputProvider(threadId));
  if (awaiting) {
    return (state: AgentRunState.waiting, errored: errored, stale: false);
  }

  final thread = ref.watch(threadByIdProvider(threadId));
  final requiresLogin = thread != null &&
      (ref.watch(authStatusProvider(thread.agentId)).value?.requiresLogin ??
          false);
  final queue = ref.watch(threadQueueForProvider(threadId));
  // A signed-out agent is blocked even while idle: its next turn cannot run.
  // A paused queue only blocks a thread that still has something queued.
  if ((requiresLogin && thread.status == ThreadStatus.active) ||
      (queue.paused && queue.length > 0)) {
    return (state: AgentRunState.blocked, errored: errored, stale: false);
  }

  if (activity == ThreadActivity.running) {
    final since = thread?.lastActivity;
    final stale =
        since != null && DateTime.now().difference(since) > kAgentStaleAfter;
    return (state: AgentRunState.working, errored: errored, stale: stale);
  }

  if (ref.watch(unreadForProvider(threadId))) {
    return (state: AgentRunState.done, errored: errored, stale: false);
  }

  return (state: AgentRunState.idle, errored: errored, stale: false);
});
