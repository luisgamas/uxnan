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

    test('stream/turn/delivered names the turn the message was folded into',
        () {
      final event = processor.classify(
        note('stream/turn/delivered', {
          'turnId': 't2',
          'threadId': 'th1',
          'intoTurnId': 't1',
        }),
      );
      // The agent took this one INTO the turn it was already running: unlike a
      // cancellation the message WAS received, and the reply lives on t1.
      expect(event, isA<TurnDeliveredEvent>());
      expect((event as TurnDeliveredEvent).turnId, 't2');
      expect(event.intoTurnId, 't1');
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
