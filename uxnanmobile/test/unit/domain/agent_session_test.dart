import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';

void main() {
  const hold = {
    'agentId': 'claude-code',
    'sessionId': 's-1',
    'holder': {'kind': 'terminal', 'name': 'Studio'},
    'heldAgoMs': 1200,
    'busy': true,
    'threadId': 'th-1',
  };

  test('a hold names its terminal, whether the agent works, its conversation',
      () {
    final parsed = AgentSessionHold.fromJson(hold)!;
    expect(parsed.holderName, 'Studio');
    expect(parsed.busy, isTrue);
    expect(parsed.threadId, 'th-1');
    expect(parsed.key, 'claude-code:s-1');
    expect(AgentSessionHold.fromJson({'agentId': 'x'}), isNull);
    expect(AgentSessionHold.fromJson('nope'), isNull);
  });

  test('a session list keeps the well-formed entries, with ages and holds', () {
    final list = AgentSessionList.fromJson(const {
      'sessions': [
        {
          'agentId': 'claude-code',
          'sessionId': 's-1',
          'cwd': '/repo',
          'title': '',
          'updatedAgoMs': 90000,
          'hold': hold,
        },
        {'agentId': 'codex'},
      ],
      'unlisted': ['antigravity-cli', 7],
    });
    final session = list.sessions.single;
    expect(session.title, isNull);
    expect(session.updatedAgo, const Duration(seconds: 90));
    expect(session.hold?.holderName, 'Studio');
    expect(session.key, 'claude-code:s-1');
    expect(list.unlisted, ['antigravity-cli']);
    expect(AgentSessionList.fromJson(null).sessions, isEmpty);
  });

  test('a hand-off outcome reads the wire and says when the session is free',
      () {
    expect(
      AgentSessionHandoffOutcome.fromWire('released').isFree,
      isTrue,
    );
    expect(AgentSessionHandoffOutcome.fromWire('notHeld').isFree, isTrue);
    expect(AgentSessionHandoffOutcome.fromWire('busy').isFree, isFalse);
    expect(
      AgentSessionHandoffOutcome.fromWire('???'),
      AgentSessionHandoffOutcome.unreachable,
    );
    expect(agentSessionKey('pi-agent', 'p'), 'pi-agent:p');
  });
}
