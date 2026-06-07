import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

Message _msg(
  String id, {
  required int order,
  List<MessageContent> contents = const [TextContent('hi')],
  String threadId = 'th1',
}) =>
    Message(
      id: id,
      threadId: threadId,
      turnId: 't1',
      role: MessageRole.assistant,
      contents: contents,
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: order,
      createdAt: DateTime.fromMillisecondsSinceEpoch(1000 + order),
    );

void main() {
  late UxnanDatabase db;
  late DriftMessageRepository repo;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    repo = DriftMessageRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('DriftMessageRepository', () {
    test('saves and reads back messages with mixed content', () async {
      await repo.saveMessage(
        _msg(
          'm1',
          order: 1,
          contents: const [
            TextContent('here is code'),
            CodeContent('print(1)', language: 'dart'),
          ],
        ),
      );

      final messages = await repo.getMessages('th1');
      expect(messages.length, 1);
      final m = messages.single;
      expect(m.contents.length, 2);
      expect(m.contents[0], isA<TextContent>());
      expect(m.contents[1], isA<CodeContent>());
      expect((m.contents[1] as CodeContent).language, 'dart');
    });

    test('returns messages ascending by order', () async {
      await repo.saveMessages([
        _msg('b', order: 2),
        _msg('a', order: 1),
        _msg('c', order: 3),
      ]);
      final messages = await repo.getMessages('th1');
      expect(messages.map((m) => m.id).toList(), ['a', 'b', 'c']);
    });

    test('limit returns the most recent N, ascending', () async {
      await repo.saveMessages([
        _msg('a', order: 1),
        _msg('b', order: 2),
        _msg('c', order: 3),
      ]);
      final messages = await repo.getMessages('th1', limit: 2);
      expect(messages.map((m) => m.id).toList(), ['b', 'c']);
    });

    test('beforeId paginates older messages', () async {
      await repo.saveMessages([
        _msg('a', order: 1),
        _msg('b', order: 2),
        _msg('c', order: 3),
      ]);
      final older = await repo.getMessages('th1', beforeId: 'c');
      expect(older.map((m) => m.id).toList(), ['a', 'b']);
    });

    test('watchMessages emits ascending on change', () async {
      final emissions = <List<String>>[];
      final sub = repo
          .watchMessages('th1')
          .listen((ms) => emissions.add(ms.map((m) => m.id).toList()));

      await repo.saveMessage(_msg('a', order: 1));
      await Future<void>.delayed(const Duration(milliseconds: 40));
      await repo.saveMessage(_msg('b', order: 2));
      await Future<void>.delayed(const Duration(milliseconds: 40));

      await sub.cancel();
      expect(emissions.last, ['a', 'b']);
    });
  });
}
