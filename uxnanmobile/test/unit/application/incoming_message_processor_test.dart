import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/application/processors/incoming_message_processor.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';

void main() {
  const processor = IncomingMessageProcessor();

  RpcMessage note(String method, Map<String, dynamic> params) =>
      RpcMessage.notification(method: method, params: params);

  group('IncomingMessageProcessor.classify', () {
    test('stream/turn/started', () {
      final event = processor.classify(
        note('stream/turn/started', {'turnId': 't1', 'threadId': 'th1'}),
      );
      expect(event, isA<TurnStartedEvent>());
      expect((event as TurnStartedEvent).turnId, 't1');
      expect(event.threadId, 'th1');
    });

    test('stream/agent/held: a hold, and a let-go without one', () {
      final held = processor.classify(
        note('stream/agent/held', {
          'agentId': 'codex',
          'sessionId': 'c-1',
          'hold': {'agentId': 'codex'},
        }),
      );
      expect(held, isA<AgentSessionHeldEvent>());
      expect((held as AgentSessionHeldEvent).hold, isNotNull);
      final free = processor.classify(
        note(
          'stream/agent/held',
          {'agentId': 'codex', 'sessionId': 'c'},
        ),
      ) as AgentSessionHeldEvent;
      expect(free.hold, isNull);
      expect(
        processor.classify(note('stream/agent/held', {'sessionId': 1})),
        isA<UnknownDomainEvent>(),
      );
    });

    test('stream/message/delta', () {
      final event = processor.classify(
        note('stream/message/delta', {'turnId': 't1', 'delta': 'hello'}),
      );
      expect(event, isA<MessageDeltaEvent>());
      expect((event as MessageDeltaEvent).delta, 'hello');
    });

    test('non-string delta degrades to empty', () {
      final event = processor.classify(
        note('stream/message/delta', {
          'turnId': 't1',
          'delta': {'type': 'command_execution'},
        }),
      ) as MessageDeltaEvent;
      expect(event.delta, '');
    });

    test('stream/thinking/delta', () {
      final event = processor.classify(
        note('stream/thinking/delta', {'turnId': 't1', 'delta': 'hmm…'}),
      );
      expect(event, isA<ThinkingDeltaEvent>());
      expect((event as ThinkingDeltaEvent).delta, 'hmm…');
    });

    test('stream/content/block decodes the block into a MessageContent', () {
      final event = processor.classify(
        note('stream/content/block', {
          'turnId': 't1',
          'content': {
            'type': 'command_execution',
            'command': 'ls',
            'status': 'completed',
          },
        }),
      );
      expect(event, isA<ContentBlockEvent>());
      final content = (event as ContentBlockEvent).content;
      expect(content, isA<CommandExecutionContent>());
      expect((content as CommandExecutionContent).command, 'ls');
    });

    test('stream/content/block with non-map content degrades gracefully', () {
      final event = processor.classify(
        note('stream/content/block', {'turnId': 't1', 'content': 'nope'}),
      );
      expect(event, isA<UnknownDomainEvent>());
    });

    test('stream/content/block carries the beforeText placement flag', () {
      final flagged = processor.classify(
        note('stream/content/block', {
          'turnId': 't1',
          'content': {
            'type': 'command_execution',
            'command': 'ls',
            'status': 'completed',
          },
          'beforeText': true,
        }),
      ) as ContentBlockEvent;
      expect(flagged.beforeText, isTrue);
      // Absent (or non-boolean) → false, the sequential default.
      final plain = processor.classify(
        note('stream/content/block', {
          'turnId': 't1',
          'content': {
            'type': 'command_execution',
            'command': 'ls',
            'status': 'completed',
          },
        }),
      ) as ContentBlockEvent;
      expect(plain.beforeText, isFalse);
    });

    test('stream/content/block carries the step id a later block replaces', () {
      final event = processor.classify(
        note('stream/content/block', {
          'turnId': 't1',
          'content': {
            'type': 'tool',
            'toolName': 'Read',
            'status': 'running',
            'blockId': 'tu_1',
          },
        }),
      ) as ContentBlockEvent;
      expect(event.blockId, 'tu_1');
      expect((event.content as ToolUseContent).running, isTrue);
    });

    test('an approval or a question is keyed by its own id', () {
      ContentBlockEvent classify(Map<String, dynamic> content) =>
          processor.classify(
            note('stream/content/block', {'turnId': 't1', 'content': content}),
          ) as ContentBlockEvent;
      // Stored before requests carried a `blockId`: a second copy (a reload
      // racing the live block) must replace the first, not add a second card.
      expect(
        classify({
          'type': 'approval',
          'approvalId': 'ap1',
          'action': 'Allow external_directory: /tmp/*',
        }).blockId,
        'ap1',
      );
      expect(
        classify({
          'type': 'question',
          'questionId': 'q1',
          'questions': <Object>[],
        }).blockId,
        'q1',
      );
      expect(
        classify({
          'type': 'approval',
          'approvalId': 'ap2',
          'blockId': 'ap2',
          'action': 'Allow Bash',
        }).blockId,
        'ap2',
      );
    });

    test('stream/turn/completed', () {
      final event = processor.classify(
        note('stream/turn/completed', {'turnId': 't1'}),
      );
      expect(event, isA<TurnCompletedEvent>());
    });

    test('stream/turn/completed carries token usage when present', () {
      final event = processor.classify(
        note('stream/turn/completed', {
          'turnId': 't1',
          'threadId': 'th1',
          'usage': {'tokens': 1250, 'contextWindow': 1000000},
        }),
      ) as TurnCompletedEvent;
      expect(event.tokens, 1250);
      expect(event.contextWindow, 1000000);
    });

    test('stream/turn/completed without usage leaves tokens null', () {
      final event = processor.classify(
        note('stream/turn/completed', {'turnId': 't1'}),
      ) as TurnCompletedEvent;
      expect(event.tokens, isNull);
      expect(event.contextWindow, isNull);
      expect(event.continuedIn, isNull);
    });

    test('stream/turn/completed carries the turn a hand-off went on in', () {
      // The bridge's hand-off (TurnCompletedParams.continuedIn): the agent
      // took a later message mid-answer.
      final event = processor.classify(
        note('stream/turn/completed', {
          'threadId': 'th1',
          'turnId': 'tA',
          'messageId': 'a-tA',
          'text': 'Reading the files',
          'continuedIn': 'tB',
        }),
      ) as TurnCompletedEvent;
      expect(event.continuedIn, 'tB');
      expect(event.text, 'Reading the files');
    });

    test('stream/turn/completed ignores an empty continuedIn', () {
      final event = processor.classify(
        note('stream/turn/completed', {'turnId': 't1', 'continuedIn': ''}),
      ) as TurnCompletedEvent;
      expect(event.continuedIn, isNull);
    });

    test('stream/turn/error carries the message (flat, back-compat)', () {
      final event = processor.classify(
        note('stream/turn/error', {'turnId': 't1', 'message': 'boom'}),
      );
      expect(event, isA<TurnErrorEvent>());
      expect((event as TurnErrorEvent).message, 'boom');
    });

    test('stream/turn/error reads the nested error.message (contract shape)',
        () {
      final event = processor.classify(
        note('stream/turn/error', {
          'turnId': 't1',
          'error': {'code': -32603, 'message': 'usage balance exhausted'},
        }),
      );
      expect(event, isA<TurnErrorEvent>());
      expect((event as TurnErrorEvent).message, 'usage balance exhausted');
    });

    test('stream/turn/aborted', () {
      final event =
          processor.classify(note('stream/turn/aborted', {'turnId': 't1'}));
      expect(event, isA<TurnAbortedEvent>());
    });

    test('stream/turn/cancelled is its own event, not an abort', () {
      final event = processor.classify(
        note('stream/turn/cancelled', {'turnId': 't1', 'threadId': 'th1'}),
      );
      // A queued turn removed before it ran — distinct from a running turn the
      // user stopped, because only one of the two leaves partial output.
      expect(event, isA<TurnCancelledEvent>());
      expect((event as TurnCancelledEvent).turnId, 't1');
    });

    test('stream/queue/updated carries the whole queue state', () {
      final event = processor.classify(
        note('stream/queue/updated', {
          'threadId': 'th1',
          'queuedTurnIds': ['t2', 't3'],
          'paused': true,
          'pausedReason': 'turnError',
        }),
      );
      expect(event, isA<QueueUpdatedEvent>());
      final queue = event as QueueUpdatedEvent;
      expect(queue.queuedTurnIds, ['t2', 't3']);
      expect(queue.paused, isTrue);
      expect(queue.pausedReason, QueuePausedReason.turnError);
      // No delivery under way → absent.
      expect(queue.deliveringTurnId, isNull);
    });

    test('stream/queue/updated carries the turn being handed to the agent', () {
      final event = processor.classify(
        note('stream/queue/updated', {
          'threadId': 'th1',
          'queuedTurnIds': ['t2', 't3'],
          'paused': false,
          'deliveringTurnId': 't2',
        }),
      );
      final queue = event as QueueUpdatedEvent;
      expect(queue.queuedTurnIds, ['t2', 't3']);
      expect(queue.deliveringTurnId, 't2');
    });

    test('a malformed queue payload degrades to an empty queue', () {
      final event = processor.classify(
        note('stream/queue/updated', {
          'threadId': 'th1',
          'queuedTurnIds': 'not-a-list',
        }),
      );
      final queue = event as QueueUpdatedEvent;
      expect(queue.queuedTurnIds, isEmpty);
      expect(queue.paused, isFalse);
      // Not paused → no reason to report.
      expect(queue.pausedReason, isNull);
    });

    test('stream/model/resolved carries the resolved model', () {
      final event = processor.classify(
        note('stream/model/resolved', {
          'turnId': 't1',
          'threadId': 'th1',
          'model': 'claude-opus-4-8',
        }),
      );
      expect(event, isA<ModelResolvedEvent>());
      final resolved = event as ModelResolvedEvent;
      expect(resolved.model, 'claude-opus-4-8');
      expect(resolved.threadId, 'th1');
    });

    test('stream/git/progress carries the phase and status', () {
      final event = processor.classify(
        note('stream/git/progress', {
          'phase': 'uploading',
          'status': 'running',
          'threadId': 'th1',
        }),
      );
      expect(event, isA<GitProgressEvent>());
      final git = event as GitProgressEvent;
      expect(git.phase, 'uploading');
      expect(git.status, GitActionPhaseStatus.running);
      expect(git.threadId, 'th1');
    });

    test('unknown status degrades to running', () {
      final event = processor.classify(
        note('stream/git/progress', {'phase': 'x', 'status': 'weird'}),
      ) as GitProgressEvent;
      expect(event.status, GitActionPhaseStatus.running);
    });

    test('stream/thread/updated carries the whole wire thread', () {
      final event = processor.classify(
        note('stream/thread/updated', {
          'thread': {'id': 'th9', 'title': 'From the desktop'},
        }),
      );
      expect(event, isA<ThreadUpdatedEvent>());
      final updated = event as ThreadUpdatedEvent;
      expect(updated.threadId, 'th9');
      expect(updated.thread['title'], 'From the desktop');
    });

    test('stream/thread/updated without a thread id is dropped', () {
      final event = processor.classify(
        note('stream/thread/updated', {
          'thread': {'title': 'no id'},
        }),
      );
      expect(event, isA<UnknownDomainEvent>());
    });

    test('stream/thread/deleted', () {
      final event = processor.classify(
        note('stream/thread/deleted', {'threadId': 'th9'}),
      );
      expect(event, isA<ThreadDeletedEvent>());
      expect((event as ThreadDeletedEvent).threadId, 'th9');
    });

    test('stream/thread/deleted carries its revision', () {
      final event = processor.classify(
        note('stream/thread/deleted', {'threadId': 'th9', 'rev': 14}),
      );
      expect((event as ThreadDeletedEvent).rev, 14);
    });

    test('stream/project/updated and stream/project/removed', () {
      final updated = processor.classify(
        note('stream/project/updated', {
          'project': {'id': 'proj_a', 'name': 'app', 'cwd': '/w/app', 'rev': 3},
        }),
      );
      expect((updated as ProjectUpdatedEvent).project['cwd'], '/w/app');
      final removed = processor.classify(
        note('stream/project/removed', {'projectId': 'proj_a', 'rev': 4}),
      );
      expect((removed as ProjectRemovedEvent).projectId, 'proj_a');
      expect(removed.rev, 4);
      expect(
        processor.classify(note('stream/project/updated', {})),
        isA<UnknownDomainEvent>(),
      );
      expect(
        processor.classify(note('stream/project/removed', {})),
        isA<UnknownDomainEvent>(),
      );
    });

    test('stream/settings, stream/presence and stream/agents', () {
      final settings = processor.classify(
        note('stream/settings/updated', {
          'settings': {'home': '/work'},
          'rev': 9,
        }),
      );
      expect((settings as SettingsUpdatedEvent).home, '/work');
      expect(settings.rev, 9);
      final named = processor.classify(
        note('stream/settings/updated', {
          'settings': {'home': '/work', 'name': 'Studio'},
          'rev': 10,
        }),
      );
      expect((named as SettingsUpdatedEvent).name, 'Studio');
      final devices = processor.classify(
        note('stream/devices/updated', {
          'devices': [
            {'deviceId': 'p1', 'displayName': 'Pixel'},
          ],
        }),
      );
      expect((devices as DevicesUpdatedEvent).devices, hasLength(1));
      final presence = processor.classify(
        note('stream/presence/updated', {
          'clients': [
            {'id': 'local:desktop', 'kind': 'desktop', 'name': 'studio'},
          ],
        }),
      );
      expect((presence as PresenceUpdatedEvent).clients, hasLength(1));
      expect(
        processor
            .classify(note('stream/agents/updated', {'agents': <Object>[]})),
        isA<AgentsUpdatedEvent>(),
      );
    });

    test('stream/turn/created keeps the turn and the sender echo id', () {
      final event = processor.classify(
        note('stream/turn/created', {
          'threadId': 'th1',
          'clientTurnId': 'bubble-1',
          'turn': {'id': 't7', 'status': 'pending', 'messages': <Object>[]},
        }),
      );
      expect(event, isA<TurnCreatedEvent>());
      final created = event as TurnCreatedEvent;
      expect(created.threadId, 'th1');
      expect(created.clientTurnId, 'bubble-1');
      expect(created.turn['id'], 't7');
    });

    test('stream/approval/resolved', () {
      final event = processor.classify(
        note('stream/approval/resolved', {
          'threadId': 'th1',
          'approvalId': 'appr-1',
          'decision': 'approveSession',
        }),
      );
      expect(event, isA<ApprovalResolvedEvent>());
      final resolved = event as ApprovalResolvedEvent;
      expect(resolved.approvalId, 'appr-1');
      expect(resolved.decision, 'approveSession');
      expect(resolved.timedOut, isFalse);
    });

    test('stream/question/resolved decodes the chosen answers', () {
      final event = processor.classify(
        note('stream/question/resolved', {
          'threadId': 'th1',
          'questionId': 'q-1',
          'answers': [
            ['B'],
            <String>[],
          ],
          'skipped': false,
          'timedOut': true,
        }),
      );
      expect(event, isA<QuestionResolvedEvent>());
      final resolved = event as QuestionResolvedEvent;
      expect(resolved.answers, [
        ['B'],
        <String>[],
      ]);
      expect(resolved.timedOut, isTrue);
    });

    test('unhandled stream methods become UnknownDomainEvent', () {
      final event = processor.classify(
        note('stream/plan/update', {'foo': 'bar'}),
      );
      expect(event, isA<UnknownDomainEvent>());
      expect((event as UnknownDomainEvent).method, 'stream/plan/update');
      expect(event.params, {'foo': 'bar'});
    });
  });
}
