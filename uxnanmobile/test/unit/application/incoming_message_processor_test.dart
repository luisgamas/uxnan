import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/application/processors/incoming_message_processor.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

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

    test('stream/turn/error carries the message', () {
      final event = processor.classify(
        note('stream/turn/error', {'turnId': 't1', 'message': 'boom'}),
      );
      expect(event, isA<TurnErrorEvent>());
      expect((event as TurnErrorEvent).message, 'boom');
    });

    test('stream/turn/aborted', () {
      final event =
          processor.classify(note('stream/turn/aborted', {'turnId': 't1'}));
      expect(event, isA<TurnAbortedEvent>());
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
