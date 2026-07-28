import 'dart:async';

import 'package:collection/collection.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// The phone's side of the message queue: a follow-up sent while the agent is
/// busy is echoed as a waiting bubble, tracks the bridge's queue state, and
/// settles when it runs — or when it is taken back.
Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 60));

void main() {
  late UxnanDatabase db;
  late DriftMessageRepository messageRepo;
  late StreamController<DomainEvent> events;
  late ThreadManager manager;
  late List<String> sentMethods;

  /// Test-settable `turn/send` result (the bridge decides whether it queued).
  late Map<String, dynamic> turnSendResult;

  /// Test-settable `turn/list` result, for the resync path.
  Object? turnListResult;

  /// When true the fake bridge rejects `turn/cancel`.
  late bool rejectCancel;

  setUp(() {
    db = UxnanDatabase.forTesting(NativeDatabase.memory());
    messageRepo = DriftMessageRepository(db);
    events = StreamController<DomainEvent>.broadcast();
    sentMethods = [];
    turnSendResult = {'turnId': 'turn-q1', 'queued': true, 'queuePosition': 1};
    turnListResult = null;
    rejectCancel = false;
    manager = ThreadManager(
      threadRepository: DriftThreadRepository(db),
      messageRepository: messageRepo,
      domainEvents: events.stream,
      sendRequest: (method, [params]) async {
        sentMethods.add(method);
        if (method == 'turn/cancel' && rejectCancel) {
          return RpcMessage.response(
            id: '1',
            error: const RpcError(code: -32008, message: 'turn not found'),
          );
        }
        final result = switch (method) {
          'turn/send' => turnSendResult,
          'turn/list' => turnListResult ?? <String, dynamic>{},
          'queue/resume' => {'queuedTurnIds': <String>[], 'paused': false},
          'queue/clear' => {'queuedTurnIds': <String>[], 'paused': false},
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

  Future<List<({String text, MessageDeliveryState state, String turnId})>>
      userMessages() async {
    final messages = await messageRepo.getMessages('th1');
    return [
      for (final m in messages)
        if (m.role == MessageRole.user)
          (text: m.plainText, state: m.deliveryState, turnId: m.turnId),
    ];
  }

  test('a queued send is echoed as a waiting message carrying its turn id',
      () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'and also fix the tests');
    await _settle();

    final messages = await userMessages();
    expect(messages.single.state, MessageDeliveryState.queued);
    // The turn id is what later lets the user take the message back.
    expect(messages.single.turnId, 'turn-q1');
  });

  test('a send that starts immediately is not marked as queued', () async {
    turnSendResult = {'turnId': 'turn-1'};
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'go');
    await _settle();

    final messages = await userMessages();
    expect(messages.single.state, MessageDeliveryState.sent);
    expect(messages.single.turnId, 'turn-1');
  });

  test('the queue notification drives the per-thread queue state', () async {
    await manager.selectThread('th1');
    expect(manager.queueOf('th1'), ThreadQueueState.empty);

    events.add(
      const QueueUpdatedEvent(
        threadId: 'th1',
        queuedTurnIds: ['turn-a', 'turn-b'],
        paused: false,
      ),
    );
    await _settle();

    final queue = manager.queueOf('th1');
    expect(queue.turnIds, ['turn-a', 'turn-b']);
    expect(queue.positionOf('turn-b'), 2);
    expect(queue.paused, isFalse);
  });

  test('a paused queue carries the reason the bridge reported', () async {
    await manager.selectThread('th1');
    events.add(
      const QueueUpdatedEvent(
        threadId: 'th1',
        queuedTurnIds: ['turn-a'],
        paused: true,
        pausedReason: QueuePausedReason.turnError,
      ),
    );
    await _settle();

    expect(manager.queueOf('th1').paused, isTrue);
    expect(manager.queueOf('th1').pausedReason, QueuePausedReason.turnError);
  });

  test('an emptied, un-paused queue drops out of the map entirely', () async {
    await manager.selectThread('th1');
    events.add(
      const QueueUpdatedEvent(
        threadId: 'th1',
        queuedTurnIds: ['turn-a'],
        paused: false,
      ),
    );
    await _settle();
    expect(manager.queueOf('th1').isNotEmpty, isTrue);

    events.add(
      const QueueUpdatedEvent(
        threadId: 'th1',
        queuedTurnIds: [],
        paused: false,
      ),
    );
    await _settle();
    expect(manager.queueOf('th1'), ThreadQueueState.empty);
  });

  test('a cancelled queued turn marks its message, keeping it in the timeline',
      () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'never mind');
    await _settle();

    events.add(
      const TurnCancelledEvent(turnId: 'turn-q1', threadId: 'th1'),
    );
    await _settle();

    final messages = await userMessages();
    // Marked, not deleted: the user should still see what they took back.
    expect(messages.single.text, 'never mind');
    expect(messages.single.state, MessageDeliveryState.cancelled);
  });

  test('a queued message becomes sent once the queue drains to it', () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'then deploy');
    await _settle();
    expect((await userMessages()).single.state, MessageDeliveryState.queued);

    events.add(const TurnStartedEvent(turnId: 'turn-q1', threadId: 'th1'));
    await _settle();

    expect((await userMessages()).single.state, MessageDeliveryState.sent);
  });

  test('cancelling a queued message routes turn/cancel with its turn id',
      () async {
    await manager.cancelQueuedTurn('th1', 'turn-q1');
    expect(sentMethods, contains('turn/cancel'));
  });

  test('resume and clear apply the queue state the bridge returns', () async {
    await manager.selectThread('th1');
    events.add(
      const QueueUpdatedEvent(
        threadId: 'th1',
        queuedTurnIds: ['turn-a'],
        paused: true,
        pausedReason: QueuePausedReason.turnAborted,
      ),
    );
    await _settle();
    expect(manager.queueOf('th1').paused, isTrue);

    await manager.resumeQueue('th1');
    await _settle();
    // Applied from the reply, so the UI settles even if the broadcast is lost.
    expect(manager.queueOf('th1'), ThreadQueueState.empty);
    expect(sentMethods, contains('queue/resume'));

    await manager.clearQueue('th1');
    expect(sentMethods, contains('queue/clear'));
  });

  test('a resync settles messages whose fate we missed while away', () async {
    await manager.selectThread('th1');
    // Three follow-ups queued before the app went away.
    for (final id in ['turn-a', 'turn-b', 'turn-c']) {
      turnSendResult = {'turnId': id, 'queued': true};
      await manager.sendUserMessage('th1', 'msg $id');
      await _settle();
    }
    final queuedStates = (await userMessages()).map((m) => m.state).toSet();
    expect(queuedStates, {MessageDeliveryState.queued});

    // While away: `turn-a` ran, `turn-b` was cancelled, `turn-c` still waits.
    turnListResult = {
      'turns': [
        {'id': 'turn-a', 'status': 'completed', 'messages': <Object?>[]},
        {'id': 'turn-b', 'status': 'cancelled', 'messages': <Object?>[]},
        {'id': 'turn-c', 'status': 'queued', 'messages': <Object?>[]},
      ],
      'total': 3,
      'queuedTurnIds': ['turn-c'],
    };
    await manager.resyncActive();
    await _settle();

    final byTurn = {
      for (final m in await userMessages()) m.turnId: m.state,
    };
    expect(byTurn['turn-a'], MessageDeliveryState.sent);
    expect(byTurn['turn-b'], MessageDeliveryState.cancelled);
    expect(byTurn['turn-c'], MessageDeliveryState.queued);
    expect(manager.queueOf('th1').turnIds, ['turn-c']);
  });

  test('an older bridge that reports no queue leaves the thread idle',
      () async {
    await manager.selectThread('th1');
    turnListResult = {'turns': <Object?>[], 'total': 0};
    await manager.resyncActive();
    await _settle();

    expect(manager.queueOf('th1'), ThreadQueueState.empty);
  });

  test('a queued turn cancelled from another device still settles the bubble',
      () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'from this phone');
    await _settle();

    // The cancel arrives as a notification we did not initiate.
    events
      ..add(const TurnCancelledEvent(turnId: 'turn-q1', threadId: 'th1'))
      ..add(
        const QueueUpdatedEvent(
          threadId: 'th1',
          queuedTurnIds: [],
          paused: false,
        ),
      );
    await _settle();

    expect(
      (await userMessages()).single.state,
      MessageDeliveryState.cancelled,
    );
    expect(manager.queueOf('th1'), ThreadQueueState.empty);
  });

  test('a cancel for an unknown turn is a no-op, not a crash', () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'mine');
    await _settle();

    events.add(
      const TurnCancelledEvent(turnId: 'turn-from-elsewhere', threadId: 'th1'),
    );
    await _settle();

    expect((await userMessages()).single.state, MessageDeliveryState.queued);
  });

  test('the timeline exposes the queued message like any other', () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'queued one');
    await _settle();

    final queued = manager.timeline.messages.firstWhereOrNull(
      (m) => m.deliveryState == MessageDeliveryState.queued,
    );
    expect(queued, isNotNull);
    expect(queued!.plainText, 'queued one');
  });

  test('queueing mid-turn must not wipe the streamed reply so far', () async {
    await manager.selectThread('th1');
    // Turn 1 starts normally and streams some text.
    turnSendResult = {'turnId': 'turn-1'};
    await manager.sendUserMessage('th1', 'first');
    await _settle();
    events.add(const TurnStartedEvent(turnId: 'turn-1', threadId: 'th1'));
    await _settle();
    events.add(const MessageDeltaEvent(turnId: 'turn-1', delta: 'part one'));
    await _settle();
    expect(
      manager.timeline.messages
          .firstWhere((m) => m.id == 'stream-turn-1')
          .plainText,
      'part one',
    );

    // The user queues a follow-up while turn 1 is still streaming.
    turnSendResult = {'turnId': 'turn-2', 'queued': true, 'queuePosition': 1};
    await manager.sendUserMessage('th1', 'second');
    await _settle();

    // The reply produced so far must still be on screen.
    expect(
      manager.timeline.messages
          .firstWhere((m) => m.id == 'stream-turn-1')
          .plainText,
      'part one',
      reason: 'queueing must not reset the live buffer of the running turn',
    );

    // And it keeps accumulating, not restarting.
    events.add(const MessageDeltaEvent(turnId: 'turn-1', delta: ' and two'));
    await _settle();
    expect(
      manager.timeline.messages
          .firstWhere((m) => m.id == 'stream-turn-1')
          .plainText,
      'part one and two',
    );
  });

  test('a queued message is pinned below the reply being streamed', () async {
    await manager.selectThread('th1');
    turnSendResult = {'turnId': 'turn-1'};
    await manager.sendUserMessage('th1', 'first');
    await _settle();
    events
      ..add(const TurnStartedEvent(turnId: 'turn-1', threadId: 'th1'))
      ..add(const MessageDeltaEvent(turnId: 'turn-1', delta: 'answering'));
    await _settle();

    turnSendResult = {'turnId': 'turn-2', 'queued': true, 'queuePosition': 1};
    await manager.sendUserMessage('th1', 'follow-up');
    await _settle();
    events.add(
      const QueueUpdatedEvent(
        threadId: 'th1',
        queuedTurnIds: ['turn-2'],
        paused: false,
      ),
    );
    await _settle();

    // A waiting message is not part of the conversation yet: it sits below
    // everything, including the reply still streaming above it.
    expect(
      manager.timeline.messages.map((m) => m.plainText).toList(),
      ['first', 'answering', 'follow-up'],
    );

    // Turn 1 finishes and the queue drains to the follow-up, which drops back
    // into its chronological place — ahead of the reply it now produces.
    events.add(
      const TurnCompletedEvent(
        turnId: 'turn-1',
        threadId: 'th1',
        text: 'answering',
      ),
    );
    await _settle();
    events
      ..add(
        const QueueUpdatedEvent(
          threadId: 'th1',
          queuedTurnIds: [],
          paused: false,
        ),
      )
      ..add(const TurnStartedEvent(turnId: 'turn-2', threadId: 'th1'));
    await _settle();
    events.add(
      const MessageDeltaEvent(turnId: 'turn-2', delta: 'second reply'),
    );
    await _settle();

    expect(
      manager.timeline.messages.map((m) => m.plainText).toList(),
      ['first', 'answering', 'follow-up', 'second reply'],
    );
  });

  test('several queued messages keep the bridge order at the bottom', () async {
    await manager.selectThread('th1');
    turnSendResult = {'turnId': 'turn-1'};
    await manager.sendUserMessage('th1', 'first');
    await _settle();
    events.add(const TurnStartedEvent(turnId: 'turn-1', threadId: 'th1'));
    await _settle();

    const queued = [('turn-a', 'queued a'), ('turn-b', 'queued b')];
    for (final entry in queued) {
      turnSendResult = {'turnId': entry.$1, 'queued': true};
      await manager.sendUserMessage('th1', entry.$2);
      await _settle();
    }
    events.add(
      const QueueUpdatedEvent(
        threadId: 'th1',
        queuedTurnIds: ['turn-a', 'turn-b'],
        paused: false,
      ),
    );
    await _settle();

    final texts = manager.timeline.messages.map((m) => m.plainText).toList();
    expect(texts.sublist(texts.length - 2), ['queued a', 'queued b']);
  });

  test('withdrawing a queued turn removes its message entirely', () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'let me rewrite this');
    await _settle();
    expect((await userMessages()).single.state, MessageDeliveryState.queued);

    // Edit: the message is going straight back into the composer, so leaving a
    // cancelled husk beside the text being re-typed would just be noise.
    final ok = await manager.withdrawQueuedTurn('th1', 'turn-q1');
    await _settle();
    expect(ok, isTrue);
    expect(await userMessages(), isEmpty);
  });

  test('withdrawing keeps the message when the bridge refuses', () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'still queued');
    await _settle();

    rejectCancel = true;
    final ok = await manager.withdrawQueuedTurn('th1', 'turn-q1');
    await _settle();

    // The turn is still queued to run, so the message must stay visible —
    // deleting it would hide something that is about to be sent.
    expect(ok, isFalse);
    expect((await userMessages()).single.state, MessageDeliveryState.queued);
  });

  test('cancelling leaves the message marked, unlike withdrawing', () async {
    await manager.selectThread('th1');
    await manager.sendUserMessage('th1', 'changed my mind');
    await _settle();

    await manager.cancelQueuedTurn('th1', 'turn-q1');
    events.add(const TurnCancelledEvent(turnId: 'turn-q1', threadId: 'th1'));
    await _settle();

    final messages = await userMessages();
    expect(messages.single.text, 'changed my mind');
    expect(messages.single.state, MessageDeliveryState.cancelled);
  });

  test('the turn state of a thread is unknown until the bridge confirms it',
      () async {
    // Reopening the app with a turn still running leaves a window where the
    // thread merely LOOKS idle. Callers must be able to tell the difference.
    expect(manager.isTurnStateKnown('th1'), isFalse);

    await manager.selectThread('th1');
    turnListResult = {'turns': <Object?>[], 'total': 0};
    await manager.resyncActive();
    await _settle();

    expect(manager.isTurnStateKnown('th1'), isTrue);
  });

  test('a failed resync leaves the turn state unconfirmed', () async {
    await manager.selectThread('th1');
    // A malformed/absent result is how a failed `turn/list` surfaces here.
    turnListResult = 'not a map';
    await manager.resyncActive();
    await _settle();

    // Better to keep hedging than to claim knowledge we do not have.
    expect(manager.isTurnStateKnown('th1'), isFalse);
  });
}
