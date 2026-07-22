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
import 'package:uxnan/domain/enums/system_content_kind.dart';
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
  // Test-settable `turn/read` result (null → empty, the no-op reconcile).
  Object? turnReadResult;
  late ThreadManager manager;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    threadRepo = DriftThreadRepository(db);
    messageRepo = DriftMessageRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    sentMethods = [];
    turnSendParams = null;
    turnListResult = null;
    turnReadResult = null;
    manager = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        sentMethods.add(method);
        if (method == 'turn/send') turnSendParams = params;
        final result = switch (method) {
          'turn/list' => turnListResult ?? <String, dynamic>{},
          'turn/read' => turnReadResult ?? <String, dynamic>{},
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

  test('resync seeds the live buffer with the in-flight turn partial text',
      () async {
    await manager.selectThread('th1');
    await _settle();

    // The bridge reports the turn still in flight AND the partial assistant
    // output it already streamed before we reconnected (it persists deltas as
    // they arrive). The re-attach must recover that text, not start empty.
    turnListResult = {
      'turns': [
        {
          'id': 'turnZ',
          'messages': [
            {'role': 'assistant', 'content': 'on it, let me check'},
          ],
        },
      ],
      'total': 1,
      'activeTurnId': 'turnZ',
    };
    await manager.resyncActive();
    await _settle();

    // The pre-reconnect text is restored immediately (not lost).
    expect(manager.timeline.isStreaming, isTrue);
    final reattached =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnZ');
    expect(_text(reattached), 'on it, let me check');

    // A delta that streams after the reconnect extends the seeded run in place
    // (no gap, no duplication) — the early text stays.
    events.add(
      const MessageDeltaEvent(turnId: 'turnZ', threadId: 'th1', delta: ' now'),
    );
    await _settle();
    final streamed =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnZ');
    expect(_text(streamed), 'on it, let me check now');

    // On completion the finalized bubble keeps the full text, early part too.
    events.add(
      const TurnCompletedEvent(
        turnId: 'turnZ',
        threadId: 'th1',
        text: 'on it, let me check now',
      ),
    );
    await _settle();
    expect(manager.timeline.isStreaming, isFalse);
    final finalized =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnZ');
    expect(_text(finalized), 'on it, let me check now');
  });

  test(
      'resync re-seeds even when the live turn is already tracked '
      '(reopen race: post-reconnect deltas arrive before turn/list)', () async {
    await manager.selectThread('th1');
    await _settle();

    // After a kill+reopen the first post-reconnect deltas re-create the live
    // buffer for the in-flight turn — with only the new tail.
    events
      ..add(const TurnStartedEvent(turnId: 'turnZ', threadId: 'th1'))
      ..add(
        const MessageDeltaEvent(
          turnId: 'turnZ',
          threadId: 'th1',
          delta: 'tail',
        ),
      );
    await _settle();

    // The turn/list re-sync then lands, carrying the bridge's FULL accumulated
    // record (it persists every delta before notifying, so the snapshot is a
    // superset of anything already applied). The old guard skipped the seed
    // because the turnId matched — silently dropping everything produced while
    // the app was closed. It must re-seed unconditionally.
    turnListResult = {
      'turns': [
        {
          'id': 'turnZ',
          'messages': [
            {'role': 'assistant', 'content': 'head produced while away. tail'},
          ],
        },
      ],
      'total': 1,
      'activeTurnId': 'turnZ',
    };
    await manager.resyncActive();
    await _settle();

    final reattached =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnZ');
    expect(_text(reattached), 'head produced while away. tail');

    // Later deltas keep extending the re-seeded run in place.
    events.add(
      const MessageDeltaEvent(turnId: 'turnZ', threadId: 'th1', delta: ' end'),
    );
    await _settle();
    final streamed =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnZ');
    expect(_text(streamed), 'head produced while away. tail end');
  });

  test('a replayed turn/started never wipes the tracked live buffer', () async {
    await manager.selectThread('th1');
    await _settle();

    events
      ..add(const TurnStartedEvent(turnId: 'turnZ', threadId: 'th1'))
      ..add(
        const MessageDeltaEvent(
          turnId: 'turnZ',
          threadId: 'th1',
          delta: 'kept text',
        ),
      );
    await _settle();

    // The reconnect catch-up replay re-delivers the turn's `turn/started`
    // (the bridge emits it once live; a duplicate can only be the replay). It
    // must not reset the buffer that may have just been seeded/streamed.
    events.add(const TurnStartedEvent(turnId: 'turnZ', threadId: 'th1'));
    await _settle();

    final streaming =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnZ');
    expect(_text(streaming), 'kept text');
  });

  test('a beforeText block lands before the open text run (never severs it)',
      () async {
    await manager.selectThread('th1');
    await _settle();

    events
      ..add(const TurnStartedEvent(turnId: 'turnB', threadId: 'th1'))
      ..add(
        const MessageDeltaEvent(
          turnId: 'turnB',
          threadId: 'th1',
          delta: 'y si re',
        ),
      )
      // A parallel-activity block (e.g. a subagent tool) arrives mid-run,
      // flagged by the bridge: it must slot BEFORE the open run…
      ..add(
        const ContentBlockEvent(
          turnId: 'turnB',
          threadId: 'th1',
          content: CommandExecutionContent(
            command: 'ls',
            status: CommandStatus.completed,
          ),
          beforeText: true,
        ),
      )
      // …so the next delta keeps extending the same run in place.
      ..add(
        const MessageDeltaEvent(
          turnId: 'turnB',
          threadId: 'th1',
          delta: 'porta',
        ),
      );
    await _settle();

    final streaming =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnB');
    expect(streaming.contents.length, 2);
    expect(streaming.contents[0], isA<CommandExecutionContent>());
    expect(streaming.contents[1], isA<TextContent>());
    expect((streaming.contents[1] as TextContent).text, 'y si reporta');
  });

  test('an unflagged block still breaks the run at a real boundary', () async {
    await manager.selectThread('th1');
    await _settle();

    events
      ..add(const TurnStartedEvent(turnId: 'turnB', threadId: 'th1'))
      ..add(
        const MessageDeltaEvent(
          turnId: 'turnB',
          threadId: 'th1',
          delta: 'First.',
        ),
      )
      ..add(
        const ContentBlockEvent(
          turnId: 'turnB',
          threadId: 'th1',
          content: CommandExecutionContent(
            command: 'ls',
            status: CommandStatus.completed,
          ),
        ),
      )
      ..add(
        const MessageDeltaEvent(
          turnId: 'turnB',
          threadId: 'th1',
          delta: 'Then.',
        ),
      );
    await _settle();

    final streaming =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnB');
    expect(streaming.contents.length, 3);
    expect((streaming.contents[0] as TextContent).text, 'First.');
    expect(streaming.contents[1], isA<CommandExecutionContent>());
    expect((streaming.contents[2] as TextContent).text, 'Then.');
  });

  test(
      'finalizes with the authoritative text when the live buffer holds only '
      'a mid-turn tail', () async {
    await manager.selectThread('th1');
    await _settle();

    // Re-attached mid-turn without a seed (e.g. the resync failed): the buffer
    // holds only the post-reconnect tail.
    events.add(
      const MessageDeltaEvent(
        turnId: 'turnT',
        threadId: 'th1',
        delta: 'only the tail',
      ),
    );
    await _settle();

    // The completion text is the bridge's FULL answer. The old code preferred
    // the live buffer whenever it held any text — persisting the truncation
    // for good. The final bubble must carry the authoritative text.
    events.add(
      const TurnCompletedEvent(
        turnId: 'turnT',
        threadId: 'th1',
        text: 'the head the phone never saw, and only the tail',
      ),
    );
    await _settle();

    final finalized =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnT');
    final text = finalized.contents.whereType<TextContent>().single;
    expect(text.text, 'the head the phone never saw, and only the tail');
  });

  test('finalizing extends the trailing run when the final text adds a tail',
      () async {
    await manager.selectThread('th1');
    await _settle();

    events
      ..add(const TurnStartedEvent(turnId: 'turnP', threadId: 'th1'))
      ..add(
        const MessageDeltaEvent(
          turnId: 'turnP',
          threadId: 'th1',
          delta: 'first ',
        ),
      )
      ..add(
        const ContentBlockEvent(
          turnId: 'turnP',
          threadId: 'th1',
          content: CommandExecutionContent(
            command: 'ls',
            status: CommandStatus.completed,
          ),
        ),
      )
      ..add(
        const MessageDeltaEvent(
          turnId: 'turnP',
          threadId: 'th1',
          delta: 'second',
        ),
      )
      // The final text carries a tail the deltas never streamed: the
      // interleave must survive, with the tail folded onto the trailing run.
      ..add(
        const TurnCompletedEvent(
          turnId: 'turnP',
          threadId: 'th1',
          text: 'first second and tail',
        ),
      );
    await _settle();

    final finalized =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnP');
    expect(finalized.contents.length, 3);
    expect((finalized.contents[0] as TextContent).text, 'first ');
    expect(finalized.contents[1], isA<CommandExecutionContent>());
    expect((finalized.contents[2] as TextContent).text, 'second and tail');
  });

  test(
      'a completed turn reconciles against the bridge record (turn/read) so '
      'the stored message converges to the authoritative interleave', () async {
    await manager.selectThread('th1');
    await _settle();

    // The live view was imperfect: it only caught the tail of the answer.
    events.add(
      const MessageDeltaEvent(turnId: 'turnQ', threadId: 'th1', delta: 'Done.'),
    );
    await _settle();

    // The bridge's authoritative record for the turn: the full ordered
    // interleave (text → work log → text).
    turnReadResult = {
      'id': 'turnQ',
      'threadId': 'th1',
      'status': 'completed',
      'messages': [
        {
          'role': 'assistant',
          'content': 'Let me check.Done.',
          'segments': [
            {'type': 'text', 'text': 'Let me check.'},
            {
              'type': 'command_execution',
              'command': 'ls',
              'status': 'completed',
            },
            {'type': 'text', 'text': 'Done.'},
          ],
        },
      ],
    };
    events.add(
      const TurnCompletedEvent(
        turnId: 'turnQ',
        threadId: 'th1',
        text: 'Let me check.Done.',
      ),
    );
    await _settle();

    expect(sentMethods, contains('turn/read'));
    final repaired =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnQ');
    expect(repaired.contents.length, 3);
    expect((repaired.contents[0] as TextContent).text, 'Let me check.');
    expect(repaired.contents[1], isA<CommandExecutionContent>());
    expect((repaired.contents[2] as TextContent).text, 'Done.');
  });

  test('resync renders history segments interleaved (work log inline)',
      () async {
    // The bridge sends the assistant turn's ordered `segments`: it narrated,
    // ran a command, then narrated again. The recovered bubble must keep that
    // order (text → work log → text), not stack all activity above one merged
    // block.
    turnListResult = {
      'turns': [
        {
          'id': 'turnS',
          'messages': [
            {
              'role': 'assistant',
              'content': 'Let me check.Done.',
              'segments': [
                {'type': 'text', 'text': 'Let me check.'},
                {
                  'type': 'command_execution',
                  'command': 'ls',
                  'status': 'completed',
                },
                {'type': 'text', 'text': 'Done.'},
              ],
            },
          ],
        },
      ],
      'total': 1,
    };
    await manager.selectThread('th1');
    await _settle();

    final msg =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnS');
    expect(msg.contents.length, 3);
    expect(msg.contents[0], isA<TextContent>());
    expect(msg.contents[1], isA<CommandExecutionContent>());
    expect(msg.contents[2], isA<TextContent>());
    expect((msg.contents[0] as TextContent).text, 'Let me check.');
    expect((msg.contents[2] as TextContent).text, 'Done.');
  });

  test('resync repairs a turn previously persisted blocks-first', () async {
    // A turn the buggy older client stored blocks-first (work log above the
    // merged text): same text + same block, wrong order.
    await messageRepo.saveMessage(
      Message(
        id: 'stream-turnR',
        threadId: 'th1',
        turnId: 'turnR',
        role: MessageRole.assistant,
        contents: const [
          CommandExecutionContent(
            command: 'ls',
            status: CommandStatus.completed,
          ),
          TextContent('Let me check.Done.'),
        ],
        deliveryState: MessageDeliveryState.delivered,
        orderIndex: 0,
        createdAt: DateTime.fromMillisecondsSinceEpoch(1000),
      ),
    );
    // The bridge now re-sends the same turn WITH ordered segments.
    turnListResult = {
      'turns': [
        {
          'id': 'turnR',
          'messages': [
            {
              'role': 'assistant',
              'content': 'Let me check.Done.',
              'segments': [
                {'type': 'text', 'text': 'Let me check.'},
                {
                  'type': 'command_execution',
                  'command': 'ls',
                  'status': 'completed',
                },
                {'type': 'text', 'text': 'Done.'},
              ],
            },
          ],
        },
      ],
      'total': 1,
    };
    await manager.selectThread('th1');
    await _settle();

    // The stored copy was rewritten into the interleaved order.
    final repaired =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnR');
    expect(repaired.contents[0], isA<TextContent>());
    expect(repaired.contents[1], isA<CommandExecutionContent>());
    expect(repaired.contents[2], isA<TextContent>());
  });

  test('resync without segments falls back to blocks-first layout', () async {
    // An older bridge (or the on-disk history fallback) sends `content` +
    // `blocks` only — no `segments`. The recovered bubble keeps the prior
    // behaviour: structured blocks first, then the merged text.
    turnListResult = {
      'turns': [
        {
          'id': 'turnB',
          'messages': [
            {
              'role': 'assistant',
              'content': 'All set.',
              'blocks': [
                {
                  'type': 'command_execution',
                  'command': 'ls',
                  'status': 'completed',
                },
              ],
            },
          ],
        },
      ],
      'total': 1,
    };
    await manager.selectThread('th1');
    await _settle();

    final msg =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnB');
    expect(msg.contents.length, 2);
    expect(msg.contents[0], isA<CommandExecutionContent>());
    expect(msg.contents[1], isA<TextContent>());
    expect((msg.contents[1] as TextContent).text, 'All set.');
  });

  test('resync seeds the re-attached live buffer with interleaved segments',
      () async {
    await manager.selectThread('th1');
    await _settle();

    // The bridge reports the in-flight turn AND its ordered partial output:
    // it narrated, ran a command, narrated again — all before we reconnected.
    turnListResult = {
      'turns': [
        {
          'id': 'turnZ',
          'messages': [
            {
              'role': 'assistant',
              'content': 'Checking.Found it.',
              'segments': [
                {'type': 'text', 'text': 'Checking.'},
                {
                  'type': 'command_execution',
                  'command': 'grep x',
                  'status': 'completed',
                },
                {'type': 'text', 'text': 'Found it.'},
              ],
            },
          ],
        },
      ],
      'total': 1,
      'activeTurnId': 'turnZ',
    };
    await manager.resyncActive();
    await _settle();

    final reattached =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnZ');
    // The interleaved order is recovered, not blocks-first.
    expect(reattached.contents[0], isA<TextContent>());
    expect(reattached.contents[1], isA<CommandExecutionContent>());
    expect(reattached.contents[2], isA<TextContent>());

    // A delta after the reconnect extends the trailing text run in place.
    events.add(
      const MessageDeltaEvent(turnId: 'turnZ', threadId: 'th1', delta: ' done'),
    );
    await _settle();
    final streamed =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnZ');
    expect((streamed.contents.last as TextContent).text, 'Found it. done');
  });

  test('a failed turn appends an inline error banner with the bridge message',
      () async {
    await manager.selectThread('th1');
    await _settle();
    events.add(
      const MessageDeltaEvent(
        turnId: 'turnE',
        threadId: 'th1',
        delta: 'working…',
      ),
    );
    await _settle();
    events.add(
      const TurnErrorEvent(
        turnId: 'turnE',
        threadId: 'th1',
        message: 'API error (status 402): Grok Build usage balance exhausted',
      ),
    );
    await _settle();

    final failed =
        manager.timeline.messages.firstWhere((m) => m.id == 'stream-turnE');
    expect(failed.deliveryState, MessageDeliveryState.failed);
    // The bridge's reason is surfaced as an inline error banner (a
    // SystemContent of kind error, rendered in red by _SystemBanner) so the
    // user sees *why* the turn failed instead of the cue silently vanishing.
    final banner = failed.contents.whereType<SystemContent>().single;
    expect(banner.kind, SystemContentKind.error);
    expect(banner.text, contains('usage balance exhausted'));
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

  test('startThread keeps the bridge title when unnamed', () async {
    final thread = await manager.startThread(projectId: 'p1', agentId: 'codex');

    expect(thread.id, 'th-new');
    expect(thread.title, 'New');
    final persisted = await threadRepo.getThread('th-new');
    expect(persisted!.title, 'New');
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

  test('first prompt replaces an id placeholder with a conversation title',
      () async {
    await manager.loadThreads();
    await threadRepo.saveThread(
      (await threadRepo.getThread('th1'))!.copyWith(title: 'th1'),
    );

    await manager.sendUserMessage(
      'th1',
      '  Explain   how the streaming timeline works.  ',
    );

    expect(
      (await threadRepo.getThread('th1'))!.title,
      'Explain how the streaming timeline works.',
    );
    expect(
      sentMethods.where((method) => method == 'thread/rename'),
      hasLength(1),
    );
  });

  test('first prompt preserves an explicit thread title', () async {
    await manager.loadThreads();
    await manager.renameThread('th1', 'Manual title');
    sentMethods.clear();

    await manager.sendUserMessage('th1', 'First prompt');

    expect((await threadRepo.getThread('th1'))!.title, 'Manual title');
    expect(sentMethods, isNot(contains('thread/rename')));
  });

  test('later prompts never replace an existing placeholder title', () async {
    await manager.loadThreads();
    await threadRepo.saveThread(
      (await threadRepo.getThread('th1'))!.copyWith(title: 'th1'),
    );
    await messageRepo.saveMessage(
      Message(
        id: 'existing-user',
        threadId: 'th1',
        turnId: 'turn-existing',
        role: MessageRole.user,
        contents: const [TextContent('Earlier prompt')],
        deliveryState: MessageDeliveryState.delivered,
        orderIndex: 0,
        createdAt: DateTime(2026),
      ),
    );
    sentMethods.clear();

    await manager.sendUserMessage('th1', 'Later prompt');

    expect((await threadRepo.getThread('th1'))!.title, 'th1');
    expect(sentMethods, isNot(contains('thread/rename')));
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

  test('resync over a half-open socket fails fast (kept local), not after 30 s',
      () async {
    // Simulates the Bug A case: on resume the socket is silently half-open, so
    // the resync `turn/list` never gets a reply. With the correlator's 30 s
    // default this hangs the thread view; the tight resync timeout makes it
    // give up fast and keep local state (the live re-attach restores the turn
    // from the stream). The 2 s guard fails if the tight timeout isn't applied.
    final stalled = ThreadManager(
      threadRepository: threadRepo,
      messageRepository: messageRepo,
      domainEvents: events.stream,
      resyncTimeout: const Duration(milliseconds: 50),
      sendRequest: (method, [params]) async {
        if (method == 'turn/list') {
          return Completer<RpcMessage>().future; // never completes
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
    await stalled.selectThread('th1');
    await _settle();

    await stalled.resyncActive().timeout(const Duration(seconds: 2));

    await stalled.dispose();
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

  test('respondQuestion sends turn/send with the questionResponse', () async {
    final ok = await manager.respondQuestion(
      threadId: 'th1',
      questionId: 'q1',
      answers: [
        ['Dart'],
        ['A', 'B'],
      ],
    );

    expect(ok, isTrue);
    expect(sentMethods, contains('turn/send'));
    expect(turnSendParams?['questionResponse'], {
      'questionId': 'q1',
      'answers': [
        ['Dart'],
        ['A', 'B'],
      ],
    });
    // It is control data, not chat: no text is sent.
    expect(turnSendParams?.containsKey('text'), isFalse);
  });
}
