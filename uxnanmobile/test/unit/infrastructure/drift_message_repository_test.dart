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
  String turnId = 't1',
  MessageDeliveryState state = MessageDeliveryState.delivered,
}) =>
    Message(
      id: id,
      threadId: threadId,
      turnId: turnId,
      role: MessageRole.assistant,
      contents: contents,
      deliveryState: state,
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

    test("keeps the turn a message's turn went on in", () async {
      await repo.saveMessages([
        _msg('handed-off', order: 1).copyWith(continuedIn: 't2'),
        _msg('plain', order: 2),
      ]);
      final messages = await repo.getMessages('th1');
      expect(messages.first.continuedIn, 't2');
      expect(messages.last.continuedIn, isNull);
    });

    test("keeps how long a message's turn worked", () async {
      await repo.saveMessages([
        _msg('timed', order: 1)
            .copyWith(turnDuration: const Duration(minutes: 5, seconds: 52)),
        _msg('running', order: 2),
      ]);
      final messages = await repo.getMessages('th1');
      expect(
        messages.first.turnDuration,
        const Duration(minutes: 5, seconds: 52),
      );
      expect(messages.last.turnDuration, isNull);
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

    test('a row written by another build decodes instead of throwing',
        () async {
      // The local database outlives a single build: a newer build (or a
      // feature branch) persists a `deliveryState` this build's enum doesn't
      // know. Reading it must degrade, not take the timeline down.
      await db.into(db.messagesTable).insert(
            MessagesTableCompanion.insert(
              id: 'foreign',
              threadId: 'th1',
              turnId: 't1',
              role: 'user',
              contentsJson: '[{"type":"text","text":"written by a newer app"}]',
              deliveryState: 'rescheduled',
              orderIndex: 1,
              createdAtMs: 1000,
            ),
          );

      final messages = await repo.getMessages('th1');
      expect(messages.single.deliveryState, MessageDeliveryState.delivered);
      expect(messages.single.role, MessageRole.user);
    });

    test('an unknown role falls back to a neutral system block', () async {
      await db.into(db.messagesTable).insert(
            MessagesTableCompanion.insert(
              id: 'alien',
              threadId: 'th1',
              turnId: 't1',
              role: 'moderator',
              contentsJson: '[{"type":"text","text":"hi"}]',
              deliveryState: 'delivered',
              orderIndex: 1,
              createdAtMs: 1000,
            ),
          );

      expect((await repo.getMessages('th1')).single.role, MessageRole.system);
    });
    test('reads only the turns, states and range it is asked for', () async {
      await repo.saveMessages([
        for (var i = 1; i <= 10; i++) _msg('m$i', order: i, turnId: 'turn$i'),
        _msg('echo', order: 11, turnId: ''),
        _msg(
          'q',
          order: 12,
          turnId: 'turn12',
          state: MessageDeliveryState.queued,
        ),
        _msg('other', order: 1, threadId: 'th2', turnId: 'turn1'),
      ]);

      expect(await repo.turnIdsOf('th1'), {
        for (var i = 1; i <= 10; i++) 'turn$i',
        '',
        'turn12',
      });
      expect(
        (await repo.getMessagesForTurns('th1', {'turn3', 'turn9'}))
            .map((m) => m.id),
        ['m3', 'm9'],
      );
      expect(
        (await repo.getMessagesForTurns(
          'th1',
          {'turn9'},
          includeUnstamped: true,
        ))
            .map((m) => m.id),
        ['m9', 'echo'],
      );
      expect(await repo.getMessagesForTurns('th1', const {}), isEmpty);
      expect(
        (await repo.getMessagesFrom('th1', fromOrderIndex: 10))
            .map((m) => m.id),
        ['m10', 'echo', 'q'],
      );
      expect(await repo.orderBounds('th1'), (min: 1, max: 12));
      expect(await repo.orderBounds('nothing'), isNull);
      expect(
        (await repo.getMessages(
          'th1',
          states: const {MessageDeliveryState.queued},
        ))
            .map((m) => m.id),
        ['q'],
      );
    });

    test('watches only the newest window, oldest first, as it changes',
        () async {
      await repo.saveMessages([
        for (var i = 1; i <= 10; i++) _msg('m$i', order: i, turnId: 'turn$i'),
      ]);
      final emissions = <List<String>>[];
      final sub = repo
          .watchMessages('th1', limit: 3)
          .listen((list) => emissions.add([for (final m in list) m.id]));
      await pumpEventQueue();
      await repo.saveMessage(_msg('m11', order: 11, turnId: 'turn11'));
      await pumpEventQueue();
      await sub.cancel();

      expect(emissions.first, ['m8', 'm9', 'm10']);
      expect(emissions.last, ['m9', 'm10', 'm11']);
    });
  });
}
