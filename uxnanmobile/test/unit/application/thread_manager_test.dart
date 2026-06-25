import 'dart:async';

import 'package:collection/collection.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
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
  Map<String, dynamic>? turnSendParams;
  // Test-settable `turn/list` result (null → empty, the no-op resync default).
  Object? turnListResult;
  late ThreadManager manager;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    threadRepo = DriftThreadRepository(db);
    messageRepo = DriftMessageRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    sentMethods = [];
    turnSendParams = null;
    turnListResult = null;
    manager = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        sentMethods.add(method);
        if (method == 'turn/send') turnSendParams = params;
        final result = switch (method) {
          'turn/list' => turnListResult ?? <String, dynamic>{},
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
          'auth/status' => {
              'agentId': params?['agentId'],
              'requiresLogin': true,
              'loginInProgress': false,
              'transportMode': 'local',
              'platform': 'win32',
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
          'thread/fork' => {
              'id': 'th-fork',
              'title': 'Thread 1 (fork)',
              'agentId': 'codex',
              'status': 'active',
              'model': 'gpt-5',
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

  test('self-heals: a delta for an untracked turn re-attaches the live view',
      () async {
    await manager.selectThread('th1');
    await _settle();
    // No TurnStartedEvent first: the app missed it (reconnected mid-turn while
    // the agent kept running on the PC). Before the fix this delta was dropped.
    expect(manager.timeline.isStreaming, isFalse);

    events.add(
      const MessageDeltaEvent(
        turnId: 'turnX',
        threadId: 'th1',
        delta: 'resumed',
      ),
    );
    await _settle();

    // The live view re-attaches: "responding…" lights up and the text renders.
    expect(manager.timeline.isStreaming, isTrue);
    expect((await manager.activityStream.first)['th1'], ThreadActivity.running);
    final streaming = manager.timeline.messages
        .firstWhereOrNull((m) => m.id == 'stream-turnX');
    expect(streaming, isNotNull);
    expect(_text(streaming!), 'resumed');

    // It then completes normally and stops "responding".
    events.add(
      const TurnCompletedEvent(
        turnId: 'turnX',
        threadId: 'th1',
        text: 'resumed',
      ),
    );
    await _settle();
    expect(manager.timeline.isStreaming, isFalse);
    expect((await manager.activityStream.first).containsKey('th1'), isFalse);
  });

  test('resyncActive re-attaches to an in-flight turn reported by the bridge',
      () async {
    await manager.selectThread('th1');
    await _settle();
    expect(manager.timeline.isStreaming, isFalse);

    // The bridge reports a turn still in flight (authoritative activeTurnId).
    turnListResult = {
      'turns': [
        {'id': 'turnZ', 'messages': <dynamic>[]},
      ],
      'total': 1,
      'activeTurnId': 'turnZ',
    };
    await manager.resyncActive();
    await _settle();

    // Re-attached immediately (before any further delta): indicator + Stop.
    expect(manager.timeline.isStreaming, isTrue);
    expect((await manager.activityStream.first)['th1'], ThreadActivity.running);

    // A subsequent delta for that turn now lands (it would have been dropped).
    events.add(
      const MessageDeltaEvent(turnId: 'turnZ', threadId: 'th1', delta: 'late'),
    );
    await _settle();
    final streaming = manager.timeline.messages
        .firstWhereOrNull((m) => m.id == 'stream-turnZ');
    expect(streaming, isNotNull);
    expect(_text(streaming!), 'late');
  });

  test('finalizes with the bridge text when re-attached without streamed text',
      () async {
    await manager.selectThread('th1');
    await _settle();
    // Re-attach via a block only (no text delta) — the early deltas were lost.
    events.add(
      const ContentBlockEvent(
        turnId: 'turnY',
        threadId: 'th1',
        content: CommandExecutionContent(
          command: 'ls',
          status: CommandStatus.completed,
        ),
      ),
    );
    await _settle();
    expect(manager.timeline.isStreaming, isTrue);

    // Completion carries the bridge's authoritative full text.
    events.add(
      const TurnCompletedEvent(
        turnId: 'turnY',
        threadId: 'th1',
        text: 'the full answer',
      ),
    );
    await _settle();

    final finalized =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnY');
    // The authoritative text shows (the live buffer had no streamed text)...
    expect(
      finalized.contents.whereType<TextContent>().map((t) => t.text).join(),
      'the full answer',
    );
    // ...and the block captured live is preserved.
    expect(
      finalized.contents.whereType<CommandExecutionContent>(),
      hasLength(1),
    );
  });

  test('folds a streaming content block (command) into the turn', () async {
    await manager.selectThread('th1');
    await _settle();
    events.add(const TurnStartedEvent(turnId: 'turn1', threadId: 'th1'));
    await _settle();

    events.add(
      const ContentBlockEvent(
        turnId: 'turn1',
        threadId: 'th1',
        content: CommandExecutionContent(
          command: 'ls',
          status: CommandStatus.completed,
        ),
      ),
    );
    await _settle();

    final streaming = manager.timeline.messages
        .firstWhereOrNull((m) => m.id == 'stream-turn1');
    expect(streaming, isNotNull);
    final commands =
        streaming!.contents.whereType<CommandExecutionContent>().toList();
    expect(commands, hasLength(1));
    expect(commands.first.command, 'ls');

    events.add(const TurnCompletedEvent(turnId: 'turn1', threadId: 'th1'));
    await _settle();

    // The block is persisted with the finalized message.
    final persisted = await messageRepo.getMessages('th1');
    final finalMsg = persisted.firstWhere((m) => m.id == 'stream-turn1');
    expect(
      finalMsg.contents.whereType<CommandExecutionContent>(),
      hasLength(1),
    );
  });

  test('ignores events for a non-active thread', () async {
    await manager.selectThread('th1');
    await _settle();
    events.add(const TurnStartedEvent(turnId: 'x', threadId: 'other'));
    await _settle();
    expect(manager.timeline.isStreaming, isFalse);
  });

  test('tracks activity and persists a streaming turn for a background thread',
      () async {
    await manager.selectThread('th1');
    await _settle();

    // A turn streams on a DIFFERENT thread than the active one.
    events
      ..add(const TurnStartedEvent(turnId: 't2', threadId: 'other'))
      ..add(
        const MessageDeltaEvent(
          turnId: 't2',
          threadId: 'other',
          delta: 'background',
        ),
      );
    await _settle();

    // The active timeline is untouched, but the other thread reads as running.
    expect(manager.timeline.isStreaming, isFalse);
    expect(
      (await manager.activityStream.first)['other'],
      ThreadActivity.running,
    );

    events.add(const TurnCompletedEvent(turnId: 't2', threadId: 'other'));
    await _settle();

    // Completed off-screen: persisted to the repo and no longer running.
    final persisted = await messageRepo.getMessages('other');
    expect(
      persisted.any((m) => m.id == 'stream-t2' && _text(m) == 'background'),
      isTrue,
    );
    expect((await manager.activityStream.first).containsKey('other'), isFalse);
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

  test('loadAuthStatus sends auth/status with the agentId and parses it',
      () async {
    final status = await manager.loadAuthStatus('codex');
    expect(status, isNotNull);
    expect(status!.agentId, 'codex');
    expect(status.requiresLogin, isTrue);
    expect(status.loginInProgress, isFalse);
    expect(status.transportMode, 'local');
    expect(sentMethods, contains('auth/status'));
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

  test('sendUserMessage forwards chosen run options on turn/send', () async {
    await manager.selectThread('th1');
    await _settle();

    await manager.sendUserMessage('th1', 'hi', options: {'reasoning': 'high'});
    await _settle();

    expect(turnSendParams?['options'], {'reasoning': 'high'});
  });

  test('sendUserMessage omits options when none are chosen', () async {
    await manager.selectThread('th1');
    await _settle();

    await manager.sendUserMessage('th1', 'hi', options: const {});
    await _settle();

    expect(turnSendParams?.containsKey('options'), isFalse);
  });

  test('sendUserMessage forwards attachments and echoes them locally',
      () async {
    await manager.selectThread('th1');
    await _settle();

    await manager.sendUserMessage(
      'th1',
      'look',
      attachments: const [
        ImageContent(mimeType: 'image/png', base64Data: 'AAAA'),
      ],
    );
    await _settle();

    expect(turnSendParams?['attachments'], [
      {'type': 'image', 'mimeType': 'image/png', 'base64Data': 'AAAA'},
    ]);
    final persisted = await messageRepo.getMessages('th1');
    final user = persisted.firstWhereOrNull((m) => m.role == MessageRole.user);
    expect(user, isNotNull);
    expect(user!.contents.whereType<ImageContent>().length, 1);
    expect(user.contents.whereType<TextContent>().single.text, 'look');
  });

  test('sendUserMessage allows an image-only message (empty text)', () async {
    await manager.selectThread('th1');
    await _settle();

    await manager.sendUserMessage(
      'th1',
      '',
      attachments: const [
        ImageContent(mimeType: 'image/jpeg', base64Data: 'BBBB'),
      ],
    );
    await _settle();

    expect(sentMethods, contains('turn/send'));
    final persisted = await messageRepo.getMessages('th1');
    final user = persisted.firstWhereOrNull((m) => m.role == MessageRole.user);
    expect(user, isNotNull);
    expect(user!.contents.whereType<TextContent>().isEmpty, isTrue);
    expect(user.contents.whereType<ImageContent>().length, 1);
  });

  test('forkThread sends thread/fork and persists the returned thread',
      () async {
    await manager.loadThreads();
    await _settle();

    final forked = await manager.forkThread('th1');

    expect(forked, isNotNull);
    expect(forked!.id, 'th-fork');
    expect(sentMethods, contains('thread/fork'));
    final stored = await threadRepo.getThread('th-fork');
    expect(stored, isNotNull);
    expect(stored!.title, 'Thread 1 (fork)');
  });

  test('resumeThread sends thread/resume', () async {
    await manager.loadThreads();
    await _settle();

    await manager.resumeThread('th1');

    expect(sentMethods, contains('thread/resume'));
  });

  test('selectThread windows history and loadMoreHistory grows it', () async {
    final messages = [
      for (var i = 0; i < 45; i++)
        _msg('m$i', order: i, role: MessageRole.assistant, text: 'reply $i'),
    ];
    await messageRepo.saveMessages(messages);

    await manager.selectThread('th1');
    await _settle();

    // The initial window renders only the most-recent page (40).
    expect(manager.timeline.messages.length, 40);
    expect(manager.timeline.hasMore, isTrue);
    expect(manager.timeline.messages.first.id, 'm5');

    unawaited(manager.loadMoreHistory());
    await _settle();

    expect(manager.timeline.messages.length, 45);
    expect(manager.timeline.hasMore, isFalse);
    expect(manager.timeline.messages.first.id, 'm0');
  });

  test('selectThread pulls the newest page and pages older remotely', () async {
    // A 25-turn thread on the bridge (more than one 20-turn page), each turn a
    // single assistant reply.
    final server = [
      for (var i = 0; i < 25; i++)
        {
          'id': 't$i',
          'messages': [
            {'role': 'assistant', 'content': 'reply $i', 'createdAt': 1000 + i},
          ],
        },
    ];
    final listCalls = <Map<String, dynamic>>[];
    final paged = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        if (method != 'turn/list') {
          return RpcMessage.response(
            id: '1',
            result: const <String, dynamic>{},
          );
        }
        final p = params ?? const <String, dynamic>{};
        listCalls.add(p);
        final total = server.length;
        final size = (p['limit'] as int?) ?? 20;
        final fromEnd = p['fromEnd'] == true;
        final start = fromEnd
            ? (total - size < 0 ? 0 : total - size)
            : int.parse(p['cursor'] as String? ?? '0');
        final end = start + size > total ? total : start + size;
        return RpcMessage.response(
          id: '1',
          result: <String, dynamic>{
            'turns': server.sublist(start, end),
            'total': total,
            if (end < total) 'nextCursor': '$end',
          },
        );
      },
    );

    await paged.selectThread('th1');
    await _settle();

    // Opened on the newest page (fromEnd), not the oldest.
    expect(listCalls.first['fromEnd'], isTrue);
    expect(paged.timeline.messages.length, 20);
    expect(_text(paged.timeline.messages.first), 'reply 5');
    expect(_text(paged.timeline.messages.last), 'reply 24');
    // 5 older turns still live on the bridge → more history is available.
    expect(paged.timeline.hasMore, isTrue);

    await paged.loadMoreHistory();
    await _settle();

    // The older page was fetched with an explicit offset cursor ('0').
    expect(listCalls.any((c) => c['cursor'] == '0'), isTrue);
    expect(paged.timeline.messages.length, 25);
    expect(_text(paged.timeline.messages.first), 'reply 0');
    expect(paged.timeline.hasMore, isFalse);

    await paged.dispose();
  });

  test('readAgentSessionId returns the session id from thread/read', () async {
    final reader = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        if (method == 'thread/read') {
          return RpcMessage.response(
            id: '1',
            result: <String, dynamic>{
              'id': params?['threadId'],
              'agentSessionId': 'sess-xyz',
            },
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

    expect(await reader.readAgentSessionId('th1'), 'sess-xyz');
    // Absent session id (older bridge / agent) degrades to null.
    final none = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: events.stream,
      sendRequest: (method, [params]) async =>
          RpcMessage.response(id: '1', result: const <String, dynamic>{}),
    );
    expect(await none.readAgentSessionId('th1'), isNull);

    await reader.dispose();
    await none.dispose();
  });

  test('access mode: reads from thread/read and persists via setAccessMode',
      () async {
    Map<String, dynamic>? setParams;
    final am = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        if (method == 'thread/read') {
          return RpcMessage.response(
            id: '1',
            result: <String, dynamic>{
              'id': params?['threadId'],
              'accessMode': 'fullAccess',
            },
          );
        }
        if (method == 'thread/setAccessMode') {
          setParams = params;
          return RpcMessage.response(
            id: '1',
            result: const <String, dynamic>{},
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

    expect(await am.readAccessMode('th1'), ApprovalMode.fullAccess);

    await am.setAccessMode('th1', ApprovalMode.requestApproval);
    expect(setParams?['threadId'], 'th1');
    expect(setParams?['mode'], 'requestApproval');

    await am.dispose();
  });

  test('resyncActive re-pulls the active thread from the bridge', () async {
    await manager.selectThread('th1');
    await _settle();
    sentMethods.clear();

    await manager.resyncActive();
    await _settle();

    // Re-pulls the newest page (turn/list) so a turn that completed while the
    // app was backgrounded / disconnected is recovered.
    expect(sentMethods, contains('turn/list'));
  });

  test('respondApproval sends turn/send with the approvalResponse', () async {
    final ok = await manager.respondApproval(
      threadId: 'th1',
      approvalId: 'ap1',
      decision: ApprovalDecision.approveSession,
    );

    expect(ok, isTrue);
    expect(sentMethods, contains('turn/send'));
    expect(turnSendParams?['approvalResponse'], {
      'approvalId': 'ap1',
      'decision': 'approveSession',
    });
    // It is control data, not chat: no text is sent.
    expect(turnSendParams?.containsKey('text'), isFalse);
  });
}
