import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/turn_timeline_snapshot.dart';

Message _msg(
  String id, {
  int order = 0,
  String turnId = 't1',
  String text = '',
  bool streaming = false,
  MessageRole role = MessageRole.assistant,
}) =>
    Message(
      id: id,
      threadId: 'th1',
      turnId: turnId,
      role: role,
      contents: [TextContent(text, isStreaming: streaming)],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: order,
      createdAt: DateTime(2026),
    );

String _textOf(Message m) => (m.contents.first as TextContent).text;

void main() {
  group('TurnTimelineSnapshot.reconcile', () {
    test('inserts and sorts by orderIndex', () {
      const snapshot = TurnTimelineSnapshot();
      final result = snapshot.reconcile([
        _msg('b', order: 2),
        _msg('a', order: 1),
      ]);
      expect(result.messages.map((m) => m.id).toList(), ['a', 'b']);
    });

    test('replaces a message with the same id', () {
      final snapshot = const TurnTimelineSnapshot()
          .reconcile([_msg('a', order: 1, text: 'old')]);
      final result = snapshot.reconcile([_msg('a', order: 1, text: 'new')]);
      expect(result.messages.length, 1);
      expect(_textOf(result.messages.single), 'new');
    });
  });

  group('TurnTimelineSnapshot pagination', () {
    test('prependHistory keeps order and updates cursor/hasMore', () {
      final snapshot =
          const TurnTimelineSnapshot().reconcile([_msg('c', order: 3)]);
      final result = snapshot.prependHistory(
        [_msg('a', order: 1), _msg('b', order: 2)],
        hasMore: true,
        nextCursor: 'cur',
      );
      expect(result.messages.map((m) => m.id).toList(), ['a', 'b', 'c']);
      expect(result.hasMore, isTrue);
      expect(result.nextCursor, 'cur');
    });
  });

  group('TurnTimelineSnapshot streaming', () {
    test('start, append deltas, then complete', () {
      final placeholder = _msg('m1', order: 1, streaming: true);
      var snapshot = const TurnTimelineSnapshot().startStreaming(placeholder);
      expect(snapshot.isStreaming, isTrue);
      expect(snapshot.streamingTurnId, 't1');

      snapshot = snapshot
          .appendStreamingDelta('t1', 'Hello, ')
          .appendStreamingDelta('t1', 'world');
      expect(_textOf(snapshot.messages.single), 'Hello, world');
      expect(snapshot.messages.single.isStreaming, isTrue);

      snapshot = snapshot.completeStreaming('t1');
      expect(snapshot.isStreaming, isFalse);
      expect(snapshot.messages.single.isStreaming, isFalse);
      expect(_textOf(snapshot.messages.single), 'Hello, world');
    });

    test('completeStreaming with a final message replaces the placeholder', () {
      final placeholder = _msg('m1', order: 1, streaming: true);
      final snapshot = const TurnTimelineSnapshot()
          .startStreaming(placeholder)
          .appendStreamingDelta('t1', 'partial');

      final result = snapshot.completeStreaming(
        't1',
        finalMessage: _msg('m1', order: 1, text: 'final answer'),
      );
      expect(result.isStreaming, isFalse);
      expect(result.messages.length, 1);
      expect(_textOf(result.messages.single), 'final answer');
    });
  });
}
