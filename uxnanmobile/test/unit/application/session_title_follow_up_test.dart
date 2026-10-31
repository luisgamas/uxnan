import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/services/session_title_follow_up.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';

// While the bridge names untitled sessions in the background, the listing is
// asked again until the names are there — a few times at most, never forever
// (architecture/02a §5.8.19).

AgentSessionList _list({required bool pending}) => AgentSessionList(
      sessions: [
        AgentSessionSummary(
          agentId: 'opencode',
          sessionId: 'o-1',
          cwd: '/app',
          updatedAgo: const Duration(minutes: 1),
          title: pending ? null : 'Named',
          titlePending: pending,
        ),
      ],
      unlisted: const [],
    );

/// Runs the follow-up over [answers] (the last one repeats), letting the
/// test clock run for [elapse], and returns what was emitted and how many
/// times the bridge was asked.
Future<({List<AgentSessionList> seen, int asked})> _run(
  WidgetTester tester,
  List<AgentSessionList> answers, {
  required Duration elapse,
  bool Function()? isActive,
}) async {
  final seen = <AgentSessionList>[];
  var asked = 0;
  followSessionTitles(
    () async {
      final answer =
          answers[asked < answers.length ? asked : answers.length - 1];
      asked++;
      return answer;
    },
    isActive: isActive ?? () => true,
  ).listen(seen.add);
  await _elapse(tester, elapse);
  return (seen: seen, asked: asked);
}

/// Advances the test clock in steps, so every timer fires in order.
Future<void> _elapse(WidgetTester tester, Duration total) async {
  const step = Duration(seconds: 1);
  for (var t = Duration.zero; t < total; t += step) {
    await tester.pump(step);
  }
}

void main() {
  test('mirrors the desktop: every 5 s, 18 times', () {
    expect(kSessionTitleFollowUpInterval, const Duration(seconds: 5));
    expect(kSessionTitleFollowUpRounds, 18);
  });

  testWidgets('a listing with nothing pending is asked once', (tester) async {
    final run = await _run(
      tester,
      [_list(pending: false)],
      elapse: const Duration(minutes: 5),
    );
    expect(run.asked, 1);
    expect(run.seen, hasLength(1));
  });

  testWidgets('asks again while one is being named, and stops once named', (
    tester,
  ) async {
    final run = await _run(
      tester,
      [_list(pending: true), _list(pending: true), _list(pending: false)],
      elapse: const Duration(minutes: 5),
    );
    expect(run.asked, 3);
    expect(run.seen.map((l) => l.sessions.single.titlePending), [
      true,
      true,
      false,
    ]);
    expect(run.seen.last.sessions.single.title, 'Named');
  });

  testWidgets('waits five seconds between asks', (tester) async {
    final run = await _run(
      tester,
      [_list(pending: true)],
      elapse: const Duration(seconds: 12),
    );
    // The first ask, then at 5 s and at 10 s.
    expect(run.asked, 3);
    // Let the rest of the bounded run finish: no timer outlives the test.
    await _elapse(tester, const Duration(minutes: 2));
  });

  testWidgets('is bounded: eighteen follow-ups, then it gives up', (
    tester,
  ) async {
    final run = await _run(
      tester,
      [_list(pending: true)],
      elapse: const Duration(minutes: 30),
    );
    expect(run.asked, 1 + kSessionTitleFollowUpRounds);
    expect(run.seen, hasLength(1 + kSessionTitleFollowUpRounds));
  });

  testWidgets('stops asking once nobody listens', (tester) async {
    var active = true;
    var asked = 0;
    followSessionTitles(
      () async {
        asked++;
        return _list(pending: true);
      },
      isActive: () => active,
    ).listen((_) {});
    await _elapse(tester, const Duration(seconds: 6));
    expect(asked, 2);
    active = false;
    await _elapse(tester, const Duration(minutes: 5));
    expect(asked, 2);
  });

  testWidgets('a failed follow-up keeps the last answer and stops', (
    tester,
  ) async {
    final seen = <AgentSessionList>[];
    var asked = 0;
    var errors = 0;
    followSessionTitles(
      () async {
        asked++;
        if (asked > 1) throw StateError('offline');
        return _list(pending: true);
      },
      isActive: () => true,
    ).listen(seen.add, onError: (Object _) => errors++);
    await _elapse(tester, const Duration(minutes: 5));
    expect(asked, 2);
    expect(seen, hasLength(1));
    expect(errors, 0);
  });

  testWidgets("a first answer that fails is the listener's error", (
    tester,
  ) async {
    var errors = 0;
    followSessionTitles(
      () => Future<AgentSessionList>.error(StateError('offline')),
      isActive: () => true,
    ).listen((_) {}, onError: (Object _) => errors++);
    await tester.pump();
    expect(errors, 1);
  });
}
