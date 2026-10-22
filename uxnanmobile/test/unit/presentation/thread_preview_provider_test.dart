import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/providers/thread_preview_provider.dart';

Message _msg(String id, int order, MessageRole role, String text) => Message(
      id: id,
      threadId: 't1',
      turnId: 'turn-$id',
      role: role,
      contents: [TextContent(text)],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: order,
      createdAt: DateTime(2026, 8, 4),
    );

void main() {
  late UxnanDatabase db;
  late DriftMessageRepository repo;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    repo = DriftMessageRepository(db);
  });
  tearDown(() => db.close());

  Future<String?> preview() async {
    final container = ProviderContainer(
      overrides: [messageRepositoryProvider.overrideWithValue(repo)],
    );
    addTearDown(container.dispose);
    return container.read(
      threadPreviewProvider((threadId: 't1', revision: 1)).future,
    );
  }

  group('threadPreviewProvider', () {
    test('shows the LATEST assistant reply, not the first', () async {
      await repo.saveMessages([
        _msg('m1', 1, MessageRole.user, 'first prompt'),
        _msg('m2', 2, MessageRole.assistant, 'the FIRST answer'),
        _msg('m3', 3, MessageRole.user, 'second prompt'),
        _msg('m4', 4, MessageRole.assistant, 'the LATEST answer'),
      ]);
      expect(await preview(), 'the LATEST answer');
    });

    test('skips a trailing non-assistant message to reach the reply', () async {
      await repo.saveMessages([
        _msg('m1', 5, MessageRole.assistant, 'the answer'),
        _msg('m2', 6, MessageRole.user, 'an unanswered follow-up'),
      ]);
      expect(await preview(), 'the answer');
    });

    test('skips an assistant message with no text', () async {
      await repo.saveMessages([
        _msg('m1', 7, MessageRole.assistant, 'the real answer'),
        _msg('m2', 8, MessageRole.assistant, '   '),
      ]);
      expect(await preview(), 'the real answer');
    });

    test('is null when the agent has said nothing yet', () async {
      await repo.saveMessage(_msg('m1', 9, MessageRole.user, 'just asked'));
      expect(await preview(), isNull);
    });

    test('collapses the reply to a single line and truncates it', () async {
      await repo.saveMessage(
        _msg('m1', 10, MessageRole.assistant, 'line one\n\n   line two'),
      );
      expect(await preview(), 'line one line two');
      await repo.saveMessage(
        _msg('m2', 11, MessageRole.assistant, 'word ' * 100),
      );
      final long = await preview();
      expect(long!.length, lessThanOrEqualTo(121));
      expect(long, endsWith('…'));
    });

    test('never decodes a message: it reads the stored preview', () async {
      // Contents no decoder could read: the preview still shows, because
      // only the column kept beside them is read.
      await db.into(db.messagesTable).insert(
            MessagesTableCompanion.insert(
              id: 'raw',
              threadId: 't1',
              turnId: 'turn-raw',
              role: 'assistant',
              contentsJson: 'not json',
              deliveryState: 'delivered',
              orderIndex: 12,
              createdAtMs: 0,
              previewText: const Value('kept beside it'),
            ),
          );
      expect(await preview(), 'kept beside it');
    });
  });
}
