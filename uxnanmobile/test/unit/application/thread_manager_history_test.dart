import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/core/errors/rpc_exception.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 60));

/// A `work` segment as `summarizeSegments` (shared/src/models/history.ts)
/// serves it.
Map<String, dynamic> _work(
  int from,
  int to, {
  int commands = 0,
  int edits = 0,
  int thoughts = 0,
  int running = 0,
  List<Map<String, dynamic>> files = const [],
  Map<String, dynamic>? last,
}) =>
    {
      'type': 'work',
      'from': from,
      'to': to,
      'commands': commands,
      'edits': edits,
      'tools': 0,
      'thoughts': thoughts,
      'failed': 0,
      'running': running,
      'files': files,
      'last': last ??
          {
            'type': 'command_execution',
            'index': to,
            'command': 'ls',
            'status': 'completed',
          },
    };

/// The page and live contract of plans/046 (bounded history), as the phone
/// applies it: summarized runs and previewed reasoning stored as served,
/// unchanged answers never rewritten, paging from the bridge's `offset`, a
/// refused page leaving the conversation as it was, and a live turn whose
/// steps are folded the way a page would serve them.
void main() {
  late UxnanDatabase db;
  late DriftMessageRepository messageRepo;
  late StreamController<DomainEvent> events;
  late StreamController<ConnectionPhase> phases;
  late List<({String method, Map<String, dynamic>? params})> calls;
  late RpcMessage Function(String method, Map<String, dynamic>? params) answer;
  late ThreadManager manager;
  // Awaited by every `turn/list` before it answers (null: answer at once).
  Future<void> Function()? gateRead;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    messageRepo = DriftMessageRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    phases = StreamController<ConnectionPhase>.broadcast();
    calls = [];
    gateRead = null;
    answer = (method, params) =>
        RpcMessage.response(id: '1', result: const <String, dynamic>{});
    manager = ThreadManager(
      threadRepository: DriftThreadRepository(db),
      messageRepository: messageRepo,
      domainEvents: events.stream,
      connectionPhases: phases.stream,
      sendRequest: (method, [params]) async {
        calls.add((method: method, params: params));
        if (method == 'turn/list') await gateRead?.call();
        return answer(method, params);
      },
    );
  });

  tearDown(() async {
    await manager.dispose();
    await events.close();
    await phases.close();
    await db.close();
  });

  Message stored(String turnId) =>
      manager.timeline.messages.firstWhere((m) => m.id == 'stream-$turnId');

  test('a summarized page is stored as served: runs, thoughts inside them',
      () async {
    answer = (method, params) => RpcMessage.response(
          id: '1',
          result: method == 'turn/list'
              ? {
                  'turns': [
                    {
                      'id': 't1',
                      'seq': 1,
                      'messages': [
                        {
                          'role': 'assistant',
                          'content': 'Checking.Done.',
                          'segments': [
                            {'type': 'text', 'text': 'Checking.'},
                            _work(
                              1,
                              5,
                              commands: 3,
                              edits: 1,
                              thoughts: 1,
                              last: {
                                'type': 'thinking',
                                'index': 5,
                                'text': 'x' * 600,
                                'textChars': 9000,
                              },
                              files: [
                                {
                                  'filename': 'a.dart',
                                  'additions': 2,
                                  'deletions': 1,
                                },
                              ],
                            ),
                            {'type': 'text', 'text': 'Done.'},
                          ],
                        },
                      ],
                    },
                  ],
                  'offset': 0,
                  'total': 1,
                }
              : <String, dynamic>{},
        );
    await manager.selectThread('th1');
    await _settle();

    final message = stored('t1');
    // No reasoning block of the turn: it is a step, in its run.
    expect(message.contents.first, const TextContent('Checking.'));
    final run = message.contents[1] as WorkRunContent;
    expect((run.from, run.to, run.commands, run.thoughts), (1, 5, 3, 1));
    final thought = run.last! as ThinkingContent;
    expect((thought.index, thought.textChars, thought.isCut), (5, 9000, true));
    expect(run.files.single.filename, 'a.dart');
    expect(message.fingerprint, isNotNull);
  });

  test('an answer the page repeats unchanged is neither decoded nor rewritten',
      () async {
    var text = 'Same answer.';
    answer = (method, params) => RpcMessage.response(
          id: '1',
          result: method == 'turn/list'
              ? {
                  'turns': [
                    {
                      'id': 't1',
                      'seq': 1,
                      'messages': [
                        {
                          'role': 'assistant',
                          'content': text,
                          'segments': [
                            {'type': 'text', 'text': text},
                          ],
                        },
                      ],
                    },
                  ],
                  'total': 1,
                }
              : <String, dynamic>{},
        );
    await manager.selectThread('th1');
    await _settle();
    final first = stored('t1');

    // Overwrite the stored contents behind the manager's back, keeping the
    // fingerprint: a resync that decoded and compared would restore them.
    await messageRepo.saveMessage(
      first.copyWith(contents: const [TextContent('local copy')]),
    );
    await manager.resyncActive();
    await _settle();
    expect(stored('t1').contents, const [TextContent('local copy')]);

    // A changed wire message is rewritten.
    text = 'A new answer.';
    await manager.resyncActive();
    await _settle();
    expect(stored('t1').contents, const [TextContent('A new answer.')]);
  });

  test('pages older history from the offset the bridge reports', () async {
    answer = (method, params) {
      if (method != 'turn/list') {
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      }
      final fromEnd = params?['fromEnd'] == true;
      // 30 turns; the byte budget trims each window to its newest 5.
      final end = fromEnd ? 30 : int.parse(params!['cursor'] as String) + 20;
      final start = end - 5;
      return RpcMessage.response(
        id: '1',
        result: {
          'turns': [
            for (var i = start; i < end; i++)
              {
                'id': 't$i',
                'seq': i + 1,
                'messages': [
                  {'role': 'assistant', 'content': 'reply $i'},
                ],
              },
          ],
          'offset': start,
          'total': 30,
        },
      );
    };
    await manager.selectThread('th1');
    await _settle();
    expect(manager.timeline.hasMore, isTrue);

    // The stored window is all on screen; the next page must END where the
    // trimmed newest page began (25), not 20 turns before the end.
    await manager.loadMoreHistory();
    await _settle();
    final older = calls.lastWhere((c) => c.method == 'turn/list');
    expect(older.params?['cursor'], '5');
    expect(older.params?['limit'], 20);
    expect(
      manager.timeline.messages.map((m) => m.plainText),
      contains('reply 20'),
    );
  });

  test('a page refused as too large keeps the conversation as it was',
      () async {
    await messageRepo.saveMessage(
      Message(
        id: 'kept',
        threadId: 'th1',
        turnId: 't0',
        role: MessageRole.assistant,
        contents: const [TextContent('what the phone had')],
        deliveryState: MessageDeliveryState.delivered,
        orderIndex: 1,
        createdAt: DateTime(2026),
      ),
    );
    answer = (method, params) => method == 'turn/list'
        ? const RpcMessage(
            id: '1',
            error: RpcError(
              code: RpcException.responseTooLarge,
              message: 'Response too large',
            ),
          )
        : RpcMessage.response(id: '1', result: const <String, dynamic>{});
    await manager.selectThread('th1');
    await _settle();
    expect(manager.timeline.messages.single.plainText, 'what the phone had');
  });

  group('the history watcher, not a poll (plans/046 phase 4b)', () {
    int listCalls() => calls.where((c) => c.method == 'turn/list').length;

    test('nothing re-reads an open conversation on a timer', () async {
      phases.add(ConnectionPhase.connected);
      await manager.selectThread('th1');
      await _settle();
      final opened = listCalls();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(listCalls(), opened);
    });

    test('a history change re-reads the open conversation once', () async {
      await manager.selectThread('th1');
      await _settle();
      final opened = listCalls();
      events.add(const HistoryChangedEvent(threadId: 'th1', rev: 4));
      await _settle();
      expect(listCalls(), opened + 1);
      final last = calls.lastWhere((c) => c.method == 'turn/list');
      expect(last.params?['fromEnd'], isTrue);
    });

    test('changes during a read queue exactly one more, never lose one',
        () async {
      await manager.selectThread('th1');
      await _settle();
      final opened = listCalls();
      // The next read waits until released, so later changes land mid-read.
      final release = Completer<void>();
      gateRead = () => release.future;
      events.add(const HistoryChangedEvent(threadId: 'th1', rev: 5));
      await _settle();
      expect(listCalls(), opened + 1);
      for (var rev = 6; rev <= 8; rev++) {
        events.add(HistoryChangedEvent(threadId: 'th1', rev: rev));
      }
      await _settle();
      expect(listCalls(), opened + 1);
      gateRead = null;
      release.complete();
      await _settle();
      // The burst is one follow-up read, after the first finished.
      expect(listCalls(), opened + 2);
    });

    test('a change to a conversation that is not open is ignored', () async {
      await manager.selectThread('th1');
      await _settle();
      final opened = listCalls();
      events.add(const HistoryChangedEvent(threadId: 'other', rev: 2));
      await _settle();
      expect(listCalls(), opened);
    });
  });

  test('a run summarized mid-turn and the steps after it end as one stored run',
      () async {
    await manager.selectThread('th1');
    await _settle();
    // Reconnected mid-turn: the page summarizes the steps so far (indexes
    // 1..3, the last one still running).
    answer = (method, params) => RpcMessage.response(
          id: '1',
          result: method == 'turn/list'
              ? {
                  'turns': [
                    {
                      'id': 'tl',
                      'seq': 1,
                      'messages': [
                        {
                          'role': 'assistant',
                          'content': 'Working.',
                          'segments': [
                            {'type': 'text', 'text': 'Working.'},
                            _work(
                              1,
                              3,
                              commands: 3,
                              running: 1,
                              last: {
                                'type': 'command_execution',
                                'index': 3,
                                'command': 'make',
                                'status': 'running',
                              },
                            ),
                          ],
                        },
                      ],
                    },
                  ],
                  'total': 1,
                  'activeTurnId': 'tl',
                }
              : <String, dynamic>{},
        );
    await manager.resyncActive();
    await _settle();

    // The running step settles (its index is inside the run)…
    events
      ..add(
        const ContentBlockEvent(
          turnId: 'tl',
          threadId: 'th1',
          content: CommandExecutionContent(
            command: 'make',
            status: CommandStatus.completed,
            exitCode: 0,
            index: 3,
          ),
          index: 3,
        ),
      )
      // …then more steps stream, and more reasoning.
      ..add(
        const ContentBlockEvent(
          turnId: 'tl',
          threadId: 'th1',
          content: DiffContent(
            filename: 'b.dart',
            diff: '',
            additions: 4,
            index: 4,
            diffChars: 80,
          ),
          index: 4,
        ),
      )
      ..add(
        const ThinkingDeltaEvent(
          turnId: 'tl',
          threadId: 'th1',
          delta: 'more',
        ),
      );
    await _settle();
    var live = stored('tl');
    final seeded = live.contents.whereType<WorkRunContent>().single;
    expect(seeded.running, 0);
    // The thought opened after the edit, at the index it is stored at, and
    // reads as the one being written.
    final thought = live.contents.whereType<ThinkingContent>().single;
    expect(
      (thought.text, thought.index, thought.isStreaming),
      (
        'more',
        5,
        true,
      ),
    );

    events.add(
      const TurnCompletedEvent(turnId: 'tl', threadId: 'th1', text: 'Working.'),
    );
    await _settle();
    live = stored('tl');
    final run = live.contents.whereType<WorkRunContent>().single;
    expect(
      (run.from, run.to, run.commands, run.edits, run.thoughts),
      (1, 5, 3, 1, 1),
    );
    expect(run.files.single.filename, 'b.dart');
    expect(live.contents.whereType<DiffContent>(), isEmpty);
    expect(live.contents.whereType<ThinkingContent>(), isEmpty);
  });

  test('a finished turn stores its thought folded, cut to the page preview',
      () async {
    await manager.selectThread('th1');
    await _settle();
    events
      ..add(
        ThinkingDeltaEvent(turnId: 'tr', threadId: 'th1', delta: 'r' * 2000),
      )
      ..add(
        const MessageDeltaEvent(turnId: 'tr', threadId: 'th1', delta: 'Ok.'),
      )
      ..add(
        const TurnCompletedEvent(turnId: 'tr', threadId: 'th1', text: 'Ok.'),
      );
    await _settle();
    final contents = (await messageRepo.getMessages('th1')).single.contents;
    final run = contents.first as WorkRunContent;
    expect((run.from, run.to, run.thoughts), (0, 0, 1));
    final thought = run.last! as ThinkingContent;
    expect((thought.text.length, thought.textChars), (600, 2000));
    expect(contents.last, const TextContent('Ok.'));
  });

  test('reasoning grows the thought it continues, wherever it is', () async {
    await manager.selectThread('th1');
    await _settle();
    // Re-attached mid-thought: the page's run ends on the thought.
    answer = (method, params) => RpcMessage.response(
          id: '1',
          result: method == 'turn/list'
              ? {
                  'turns': [
                    {
                      'id': 'tg',
                      'seq': 1,
                      'messages': [
                        {
                          'role': 'assistant',
                          'content': '',
                          'segments': [
                            _work(
                              0,
                              1,
                              commands: 1,
                              thoughts: 1,
                              last: {
                                'type': 'thinking',
                                'index': 1,
                                'text': 'so far',
                              },
                            ),
                          ],
                        },
                      ],
                    },
                  ],
                  'total': 1,
                  'activeTurnId': 'tg',
                }
              : <String, dynamic>{},
        );
    await manager.resyncActive();
    await _settle();
    events
      ..add(
        const ThinkingDeltaEvent(turnId: 'tg', threadId: 'th1', delta: ' more'),
      )
      ..add(
        const MessageDeltaEvent(turnId: 'tg', threadId: 'th1', delta: 'Hi.'),
      )
      ..add(
        const ThinkingDeltaEvent(turnId: 'tg', threadId: 'th1', delta: 'next'),
      );
    await _settle();
    final live = stored('tg').contents;
    final run = live.first as WorkRunContent;
    expect((run.last! as ThinkingContent).text, 'so far more');
    // Text after it, then a new thought at the end, after the text.
    expect((live[1] as TextContent).text, 'Hi.');
    final next = live[2] as ThinkingContent;
    expect((next.text, next.index, next.isStreaming), ('next', 3, true));
  });
}
