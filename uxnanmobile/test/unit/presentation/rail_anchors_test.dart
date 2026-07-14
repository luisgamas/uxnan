import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/providers/rail_anchors.dart';

Message _msg(
  String id,
  MessageRole role,
  String text, {
  required int order,
}) {
  return Message(
    id: id,
    threadId: 't',
    turnId: 'turn-$id',
    role: role,
    contents: [TextContent(text)],
    deliveryState: MessageDeliveryState.sent,
    orderIndex: order,
    createdAt: DateTime(2026, 6, 15).add(Duration(seconds: order)),
  );
}

void main() {
  group('deriveRailAnchors', () {
    test('empty timeline yields no anchors', () {
      expect(deriveRailAnchors(const []).items, isEmpty);
    });

    test('one anchor per user message, mapping ticks to message indices', () {
      final messages = [
        _msg('u1', MessageRole.user, 'first question', order: 0),
        _msg('a1', MessageRole.assistant, 'first answer', order: 1),
        _msg('s1', MessageRole.system, 'a system note', order: 2),
        _msg('u2', MessageRole.user, 'second question', order: 3),
        _msg('a2', MessageRole.assistant, 'second answer', order: 4),
      ];

      final anchors = deriveRailAnchors(messages);

      expect(anchors.items.length, 2);
      // Ticks map back to the user messages' positions in the full list.
      expect(anchors.messageIndices, [0, 3]);
      expect(anchors.tickForId, {'u1': 0, 'u2': 1});
      expect(anchors.items[0].preview, 'first question');
      expect(anchors.items[1].preview, 'second question');
    });

    test("secondary preview is the turn's final assistant reply", () {
      final messages = [
        _msg('u1', MessageRole.user, 'do the thing', order: 0),
        _msg('a1', MessageRole.assistant, 'working on it', order: 1),
        _msg('a2', MessageRole.assistant, 'done, here it is', order: 2),
        _msg('u2', MessageRole.user, 'thanks', order: 3),
      ];

      final anchors = deriveRailAnchors(messages);

      // The last assistant text of the turn wins; a turn with no reply is null.
      expect(anchors.items[0].secondaryPreview, 'done, here it is');
      expect(anchors.items[1].secondaryPreview, isNull);
    });
  });

  group('railPreviewText', () {
    test('collapses whitespace and trims', () {
      final message = _msg(
        'u1',
        MessageRole.user,
        '  line one\n\n   line   two \t',
        order: 0,
      );
      expect(railPreviewText(message, maxLength: 140), 'line one line two');
    });

    test('truncates past maxLength with an ellipsis', () {
      final message = _msg('u1', MessageRole.user, 'x' * 200, order: 0);
      final preview = railPreviewText(message, maxLength: 10);
      expect(preview, '${'x' * 10}…');
      expect(preview.length, 11);
    });
  });
}
