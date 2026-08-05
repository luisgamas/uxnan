import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/repositories/i_message_repository.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/providers/thread_preview_provider.dart';

/// Returns a fixed list, in the order the real repository does: the newest N,
/// but **ascending** (oldest first). Getting that backwards is the whole bug
/// this file exists to prevent.
class _FakeMessageRepository implements IMessageRepository {
  _FakeMessageRepository(this.messages);

  final List<Message> messages;
  int? lastLimit;

  @override
  Future<List<Message>> getMessages(
    String threadId, {
    int? limit,
    String? beforeId,
  }) async {
    lastLimit = limit;
    final take = limit == null || limit >= messages.length
        ? messages
        : messages.sublist(messages.length - limit);
    return take;
  }

  @override
  Future<void> saveMessage(Message message) async {}
  @override
  Future<void> saveMessages(List<Message> messages) async {}
  @override
  Future<void> deleteMessage(String id) async {}
  @override
  Stream<List<Message>> watchMessages(String threadId) => const Stream.empty();
}

Message _msg(String id, int order, MessageRole role, String text) => Message(
      id: id,
      threadId: 't1',
      turnId: 'turn-1',
      role: role,
      contents: [TextContent(text)],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: order,
      createdAt: DateTime(2026, 8, 4),
    );

Future<String?> _preview(_FakeMessageRepository repo) async {
  final container = ProviderContainer(
    overrides: [messageRepositoryProvider.overrideWithValue(repo)],
  );
  addTearDown(container.dispose);
  return container.read(
    threadPreviewProvider((threadId: 't1', revision: 1)).future,
  );
}

void main() {
  group('threadPreviewProvider', () {
    test('shows the LATEST assistant reply, not the first', () async {
      // The regression: walking the ascending list forward pinned the row to
      // the agent's opening answer and it never changed again.
      final repo = _FakeMessageRepository([
        _msg('m1', 1, MessageRole.user, 'first prompt'),
        _msg('m2', 2, MessageRole.assistant, 'the FIRST answer'),
        _msg('m3', 3, MessageRole.user, 'second prompt'),
        _msg('m4', 4, MessageRole.assistant, 'the LATEST answer'),
      ]);
      expect(await _preview(repo), 'the LATEST answer');
    });

    test('skips a trailing non-assistant message to reach the reply', () async {
      final repo = _FakeMessageRepository([
        _msg('m1', 5, MessageRole.assistant, 'the answer'),
        _msg('m2', 6, MessageRole.user, 'an unanswered follow-up'),
      ]);
      expect(await _preview(repo), 'the answer');
    });

    test('skips an assistant message with no text', () async {
      final repo = _FakeMessageRepository([
        _msg('m1', 7, MessageRole.assistant, 'the real answer'),
        _msg('m2', 8, MessageRole.assistant, '   '),
      ]);
      expect(await _preview(repo), 'the real answer');
    });

    test('is null when the agent has said nothing yet', () async {
      final repo = _FakeMessageRepository([
        _msg('m1', 9, MessageRole.user, 'just asked'),
      ]);
      expect(await _preview(repo), isNull);
    });

    test('collapses the reply to a single line', () async {
      final repo = _FakeMessageRepository([
        _msg('m1', 10, MessageRole.assistant, 'line one\n\n   line two'),
      ]);
      expect(await _preview(repo), 'line one line two');
    });

    test('asks for only a few messages, not the whole thread', () async {
      final repo = _FakeMessageRepository([
        _msg('m1', 11, MessageRole.assistant, 'hi'),
      ]);
      await _preview(repo);
      // This runs once per visible row, so it must stay a bounded read.
      expect(repo.lastLimit, isNotNull);
      expect(repo.lastLimit, lessThanOrEqualTo(10));
    });
  });
}
