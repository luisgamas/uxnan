import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// Classifies inbound bridge notifications into [DomainEvent]s (spec 02a
/// §5.2.5).
///
/// The `SessionCoordinator` already decrypts envelopes and routes responses to
/// their callers; this processor turns the remaining inbound notifications
/// (`stream/*`) into typed domain events the managers can apply.
class IncomingMessageProcessor {
  /// Creates an [IncomingMessageProcessor].
  const IncomingMessageProcessor();

  /// Maps a single [message] to a [DomainEvent].
  DomainEvent classify(RpcMessage message) {
    final method = message.method ?? '';
    final params = message.params ?? const <String, dynamic>{};
    final turnId = params['turnId'] as String? ?? '';
    final threadId = params['threadId'] as String?;

    return switch (method) {
      'stream/turn/started' =>
        TurnStartedEvent(turnId: turnId, threadId: threadId),
      'stream/message/delta' => MessageDeltaEvent(
          turnId: turnId,
          threadId: threadId,
          delta: params['delta'] is String ? params['delta'] as String : '',
        ),
      'stream/thinking/delta' => ThinkingDeltaEvent(
          turnId: turnId,
          threadId: threadId,
          delta: params['delta'] is String ? params['delta'] as String : '',
        ),
      'stream/content/block' =>
        _contentBlock(turnId, threadId, params['content']),
      'stream/turn/completed' => TurnCompletedEvent(
          turnId: turnId,
          threadId: threadId,
          text: params['text'] is String ? params['text'] as String : null,
          tokens: _usageInt(params['usage'], 'tokens'),
          contextWindow: _usageInt(params['usage'], 'contextWindow'),
        ),
      'stream/turn/error' => TurnErrorEvent(
          turnId: turnId,
          threadId: threadId,
          message: params['message'] as String?,
        ),
      'stream/turn/aborted' =>
        TurnAbortedEvent(turnId: turnId, threadId: threadId),
      'stream/model/resolved' => ModelResolvedEvent(
          model: params['model'] is String ? params['model'] as String : '',
          turnId: turnId,
          threadId: threadId,
        ),
      'stream/git/progress' => GitProgressEvent(
          phase: params['phase'] as String? ?? '',
          status: _phaseStatus(params['status'] as String?),
          threadId: threadId,
        ),
      _ => UnknownDomainEvent(
          method: method,
          params: message.params,
        ),
    };
  }

  /// Decodes a `stream/content/block` payload into a [ContentBlockEvent], or an
  /// [UnknownDomainEvent] when the content isn't a decodable block.
  DomainEvent _contentBlock(String turnId, String? threadId, Object? content) {
    if (content is Map) {
      return ContentBlockEvent(
        turnId: turnId,
        threadId: threadId,
        content: MessageContent.fromJson(content.cast<String, dynamic>()),
      );
    }
    return const UnknownDomainEvent(method: 'stream/content/block');
  }

  /// Maps a stream of inbound [source] messages to a stream of domain events.
  Stream<DomainEvent> bind(Stream<RpcMessage> source) => source.map(classify);

  /// Reads an int field from the `usage` map of a turn-completed notification.
  static int? _usageInt(Object? usage, String key) {
    if (usage is! Map) return null;
    final value = usage[key];
    return value is int ? value : (value is num ? value.toInt() : null);
  }

  static GitActionPhaseStatus _phaseStatus(String? name) {
    for (final value in GitActionPhaseStatus.values) {
      if (value.name == name) return value;
    }
    return GitActionPhaseStatus.running;
  }
}
