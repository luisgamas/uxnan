import 'dart:async';

import 'package:collection/collection.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

Message _msg(
  String id, {
  required int order,
  required MessageRole role,
  String text = '',
  String threadId = 'th1',
}) =>
    Message(
      id: id,
      threadId: threadId,
      turnId: '',
      role: role,
      contents: [TextContent(text)],
      deliveryState: MessageDeliveryState.delivered,
      orderIndex: order,
      createdAt: DateTime.fromMillisecondsSinceEpoch(1000 + order),
    );

String _text(Message m) => (m.contents.first as TextContent).text;

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 60));

void main() {
  late UxnanDatabase db;
  late DriftThreadRepository threadRepo;
  late DriftMessageRepository messageRepo;
  late StreamController<DomainEvent> events;
  late List<String> sentMethods;
  late ThreadManager manager;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    threadRepo = DriftThreadRepository(db);
    messageRepo = DriftMessageRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    sentMethods = [];
    manager = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        sentMethods.add(method);
        final result = switch (method) {
          'thread/list' => [
              {
                'id': 'th1',
                'title': 'Thread 1',
                'agentId': 'codex',
                'status': 'active',
                'model': 'gpt-5',
              },
            ],
          'project/list' => [
              {'id': 'p1', 'name': 'App', 'cwd': '/projects/app'},
            ],
          'agent/list' => {
              'agents': [
                {'agentId': 'codex', 'displayName': 'Codex', 'available': true},
              ],
            },
          'thread/start' => {
              'id': 'th-new',
              'title': params?['title'] ?? 'New',
              'agentId': params?['agentId'] ?? 'custom',
              'projectId': params?['projectId'],
              'cwd': params?['cwd'],
              'model': params?['model'],
              'status': 'active',
            },
          _ => <String, dynamic>{},
        };
        return RpcMessage.response(id: '1', result: result);
      },
    );
  });

  tearDown(() async {
    await manager.dispose();
    await events.close();
    await db.close();
  });

  test('selectThread builds the timeline from local messages', () async {
    await messageRepo.saveMessages([
      _msg('m1', order: 0, role: MessageRole.user, text: 'hi'),
      _msg('m2', order: 1, role: MessageRole.assistant, text: 'hello'),
    ]);

    await manager.selectThread('th1');
    await _settle();

    expect(manager.timeline.messages.map((m) => m.id).toList(), ['m1', 'm2']);
  });

  test('applies a streaming turn: started, deltas, completed', () async {
    await manager.selectThread('th1');
    await _settle();

    events.add(const TurnStartedEvent(turnId: 'turn1', threadId: 'th1'));
    await _settle();
    expect(manager.timeline.isStreaming, isTrue);

    events
      ..add(const MessageDeltaEvent(turnId: 'turn1', delta: 'Hello, '))
      ..add(const MessageDeltaEvent(turnId: 'turn1', delta: 'world'));
    await _settle();

    final streaming = manager.timeline.messages
        .firstWhereOrNull((m) => m.id == 'stream-turn1');
    expect(streaming, isNotNull);
    expect(_text(streaming!), 'Hello, world');
    expect(streaming.isStreaming, isTrue);

    events.add(const TurnCompletedEvent(turnId: 'turn1', threadId: 'th1'));
    await _settle();

    expect(manager.timeline.isStreaming, isFalse);
    final finalized =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turn1');
    expect(finalized.isStreaming, isFalse);
    expect(_text(finalized), 'Hello, world');

    // The finalized message is persisted.
    final persisted = await messageRepo.getMessages('th1');
    expect(persisted.any((m) => m.id == 'stream-turn1'), isTrue);
  });

  test('ignores events for a non-active thread', () async {
    await manager.selectThread('th1');
    await _settle();
    events.add(const TurnStartedEvent(turnId: 'x', threadId: 'other'));
    await _settle();
    expect(manager.timeline.isStreaming, isFalse);
  });

  test('loadThreads parses and persists the thread list (incl. model)',
      () async {
    await manager.loadThreads();
    final threads = await threadRepo.getThreads();
    expect(threads.map((t) => t.id).toList(), ['th1']);
    expect(threads.single.title, 'Thread 1');
    expect(threads.single.model, 'gpt-5');
    expect(sentMethods, contains('thread/list'));
  });

  test('loadProjects parses the project list', () async {
    final projects = await manager.loadProjects();
    expect(projects.single.id, 'p1');
    expect(projects.single.cwd, '/projects/app');
    expect(sentMethods, contains('project/list'));
  });

  test('loadAgents parses the agent list', () async {
    final agents = await manager.loadAgents();
    expect(agents.single.agentId, 'codex');
    expect(agents.single.available, isTrue);
    expect(sentMethods, contains('agent/list'));
  });

  test('startThread sends thread/start and persists the result', () async {
    final thread = await manager.startThread(
      projectId: 'p1',
      title: 'My thread',
      agentId: 'codex',
      model: 'gpt-5',
      cwd: '/projects/app',
    );
    expect(thread.id, 'th-new');
    expect(thread.agentId, 'codex');
    expect(thread.cwd, '/projects/app');
    expect(thread.model, 'gpt-5');
    expect(sentMethods, contains('thread/start'));

    final persisted = await threadRepo.getThread('th-new');
    expect(persisted, isNotNull);
    expect(persisted!.model, 'gpt-5');
  });

  test('renameThread updates the local title and sends thread/rename',
      () async {
    await manager.loadThreads();
    await manager.renameThread('th1', '  Renamed  ');

    final thread = await threadRepo.getThread('th1');
    expect(thread!.title, 'Renamed');
    expect(sentMethods, contains('thread/rename'));
  });

  test('renameThread ignores a blank title', () async {
    await manager.loadThreads();
    await manager.renameThread('th1', '   ');

    final thread = await threadRepo.getThread('th1');
    expect(thread!.title, 'Thread 1');
    expect(sentMethods, isNot(contains('thread/rename')));
  });

  test('renameThread keeps the local rename when the bridge call fails',
      () async {
    await manager.loadThreads();
    final failingEvents = StreamController<DomainEvent>.broadcast();
    final failing = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: failingEvents.stream,
      sendRequest: (method, [params]) async =>
          throw StateError('unsupported method'),
    );

    await failing.renameThread('th1', 'Renamed offline');
    expect((await threadRepo.getThread('th1'))!.title, 'Renamed offline');

    await failing.dispose();
    await failingEvents.close();
  });

  test('deleteThread removes it locally and sends thread/delete', () async {
    await manager.loadThreads();
    await manager.deleteThread('th1');

    expect(await threadRepo.getThread('th1'), isNull);
    expect(sentMethods, contains('thread/delete'));
  });

  test('deleteThread clears the active timeline for the active thread',
      () async {
    await manager.loadThreads();
    await manager.selectThread('th1');
    await _settle();

    await manager.deleteThread('th1');
    expect(manager.activeThreadId, isNull);
  });

  test('archiveThread sets the local status and sends thread/archive',
      () async {
    await manager.loadThreads();
    await manager.archiveThread('th1');

    final thread = await threadRepo.getThread('th1');
    expect(thread!.status, ThreadStatus.archived);
    expect(sentMethods, contains('thread/archive'));
  });

  test('unarchiveThread restores active and sends thread/unarchive', () async {
    await manager.loadThreads();
    await manager.archiveThread('th1');
    await manager.unarchiveThread('th1');

    final thread = await threadRepo.getThread('th1');
    expect(thread!.status, ThreadStatus.active);
    expect(sentMethods, contains('thread/unarchive'));
  });

  test('startThread defaults the title to the thread id when unnamed',
      () async {
    final thread = await manager.startThread(projectId: 'p1', agentId: 'codex');

    expect(thread.id, 'th-new');
    expect(thread.title, 'th-new');
    final persisted = await threadRepo.getThread('th-new');
    expect(persisted!.title, 'th-new');
  });

  test('startThread keeps an explicit user title', () async {
    final thread = await manager.startThread(
      projectId: 'p1',
      title: 'My thread',
      agentId: 'codex',
    );

    expect(thread.title, 'My thread');
  });

  test('sendUserMessage persists locally and sends turn/send', () async {
    await manager.selectThread('th1');
    await _settle();

    await manager.sendUserMessage('th1', 'hola');
    await _settle();

    expect(sentMethods, contains('turn/send'));
    final persisted = await messageRepo.getMessages('th1');
    final user = persisted.firstWhereOrNull(
      (m) => m.role == MessageRole.user,
    );
    expect(user, isNotNull);
    expect(_text(user!), 'hola');
  });
}
