import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/turn.dart';
import 'package:uxnan/domain/enums/turn_status.dart';

void main() {
  final started = DateTime(2026, 9, 28);

  test('a turn carries the later turn its run went on in', () {
    final turn = Turn(
      id: 'tA',
      threadId: 'th1',
      status: TurnStatus.completed,
      startedAt: started,
      continuedIn: 'tB',
    );
    expect(turn.continuedIn, 'tB');
    // copyWith keeps it unless replaced, and it takes part in equality.
    expect(turn.copyWith(status: TurnStatus.completed).continuedIn, 'tB');
    expect(
      turn,
      isNot(
        Turn(
          id: 'tA',
          threadId: 'th1',
          status: TurnStatus.completed,
          startedAt: started,
        ),
      ),
    );
  });

  test('a turn nothing interrupted has no continuation', () {
    final turn = Turn(
      id: 'tA',
      threadId: 'th1',
      status: TurnStatus.completed,
      startedAt: started,
    );
    expect(turn.continuedIn, isNull);
    expect(turn.copyWith(continuedIn: 'tB').continuedIn, 'tB');
  });
}
