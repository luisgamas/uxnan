import 'package:uxnan/domain/value_objects/agent_session.dart';

/// How long to wait before asking again while the bridge names sessions
/// (`TITLE_FOLLOW_UP_MS` on Uxnan Desktop).
const Duration kSessionTitleFollowUpInterval = Duration(milliseconds: 5000);

/// How many times to ask again at most — about a minute and a half — before
/// giving up until the next visit (`TITLE_FOLLOW_UP_ROUNDS` on Uxnan Desktop).
const int kSessionTitleFollowUpRounds = 18;

/// A folder's agent sessions as the bridge lists them, followed while it
/// names some of them (architecture/02a §5.8.19).
///
/// The bridge names an untitled session in the background — `titlePending` —
/// and the title shows on a later answer; no notification says when. So this
/// emits the first answer, and while any listed session is still pending it
/// asks again every [interval], at most [rounds] times. An answer with
/// nothing pending, a failed follow-up (the last answer stays) or [isActive]
/// turning false (the listener left) ends it. Asking again from the outside
/// is a new call: the count starts over.
Stream<AgentSessionList> followSessionTitles(
  Future<AgentSessionList> Function() load, {
  required bool Function() isActive,
  Duration interval = kSessionTitleFollowUpInterval,
  int rounds = kSessionTitleFollowUpRounds,
}) async* {
  var list = await load();
  yield list;
  for (var round = 0; round < rounds; round++) {
    if (!list.sessions.any((s) => s.titlePending)) return;
    await Future<void>.delayed(interval);
    if (!isActive()) return;
    try {
      list = await load();
    } on Object {
      return;
    }
    yield list;
  }
}
