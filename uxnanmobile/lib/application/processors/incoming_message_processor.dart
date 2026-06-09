import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
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
      'stream/turn/completed' =>
        TurnCompletedEvent(turnId: turnId, threadId: threadId),
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

  /// Maps a stream of inbound [source] messages to a stream of domain events.
  Stream<DomainEvent> bind(Stream<RpcMessage> source) => source.map(classify);

  static GitActionPhaseStatus _phaseStatus(String? name) {
    for (final value in GitActionPhaseStatus.values) {
      if (value.name == name) return value;
    }
    return GitActionPhaseStatus.running;
  }
}
