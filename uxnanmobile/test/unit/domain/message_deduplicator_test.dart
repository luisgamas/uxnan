import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/services/message_deduplicator.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

Message _msg(
  String id, {
  String? fingerprint,
  String text = 'hi',
}) =>
    Message(
      id: id,
      threadId: 'th1',
      turnId: 't1',
      role: MessageRole.assistant,
      contents: [TextContent(text)],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: 0,
      fingerprint: fingerprint,
      createdAt: DateTime(2026),
    );

void main() {
  group('MessageDeduplicator', () {
    test('dedups by fingerprint when present', () {
      final dedup = MessageDeduplicator();
      expect(dedup.isDuplicate(_msg('a', fingerprint: 'fp1')), isFalse);
      // Different id but same fingerprint => duplicate (e.g. a replay).
      expect(dedup.isDuplicate(_msg('b', fingerprint: 'fp1')), isTrue);
      expect(dedup.isDuplicate(_msg('c', fingerprint: 'fp2')), isFalse);
    });

    test('falls back to the message id when no fingerprint', () {
      final dedup = MessageDeduplicator();
      expect(dedup.isDuplicate(_msg('a')), isFalse);
      expect(dedup.isDuplicate(_msg('a')), isTrue);
      expect(dedup.isDuplicate(_msg('b')), isFalse);
    });

    test('uses an injected content resolver as the fallback', () {
      final dedup = MessageDeduplicator(
        fingerprintOf: (m) => m.plainText,
      );
      // Same content, different ids, no fingerprints => duplicate.
      expect(dedup.isDuplicate(_msg('a', text: 'same')), isFalse);
      expect(dedup.isDuplicate(_msg('b', text: 'same')), isTrue);
      expect(dedup.isDuplicate(_msg('c', text: 'other')), isFalse);
    });

    test('reset clears the seen set', () {
      final dedup = MessageDeduplicator()..isDuplicate(_msg('a'));
      expect(dedup.seenCount, 1);
      dedup.reset();
      expect(dedup.seenCount, 0);
      expect(dedup.isDuplicate(_msg('a')), isFalse);
    });
  });
}
