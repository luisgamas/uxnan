import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';

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
      'stream/content/block' => _contentBlock(
          turnId,
          threadId,
          params['content'],
          beforeText: params['beforeText'] == true,
        ),
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
          // The contract nests the reason under `error` (`TurnErrorParams`:
          // `error: { code, message }`); tolerate a flat `message` too.
          message: params['error'] is Map
              ? (params['error'] as Map)['message'] as String?
              : params['message'] as String?,
        ),
      'stream/turn/aborted' =>
        TurnAbortedEvent(turnId: turnId, threadId: threadId),
      'stream/turn/cancelled' =>
        TurnCancelledEvent(turnId: turnId, threadId: threadId),
      'stream/queue/updated' => QueueUpdatedEvent(
          threadId: threadId,
          queuedTurnIds: _stringList(params['queuedTurnIds']),
          paused: params['paused'] == true,
          pausedReason: params['paused'] == true
              ? QueuePausedReason.fromWire(params['pausedReason'])
              : null,
        ),
      'stream/thread/updated' => _threadUpdated(params['thread']),
      'stream/thread/deleted' => ThreadDeletedEvent(
          threadId: threadId,
          rev: params['rev'] is int ? params['rev'] as int : null,
        ),
      'stream/project/updated' => params['project'] is Map
          ? ProjectUpdatedEvent(
              project: (params['project'] as Map).cast<String, dynamic>(),
            )
          : const UnknownDomainEvent(method: 'stream/project/updated'),
      'stream/project/removed' => params['projectId'] is String
          ? ProjectRemovedEvent(
              projectId: params['projectId'] as String,
              rev: params['rev'] is int ? params['rev'] as int : null,
            )
          : const UnknownDomainEvent(method: 'stream/project/removed'),
      'stream/settings/updated' => SettingsUpdatedEvent(
          home: switch (params['settings']) {
            {'home': final String home} => home,
            _ => null,
          },
          name: switch (params['settings']) {
            {'name': final String name} => name,
            _ => null,
          },
          rev: params['rev'] is int ? params['rev'] as int : null,
        ),
      'stream/presence/updated' => PresenceUpdatedEvent(
          clients: params['clients'] is List
              ? params['clients'] as List<Object?>
              : const [],
        ),
      'stream/agents/updated' => const AgentsUpdatedEvent(),
      'stream/devices/updated' => DevicesUpdatedEvent(
          devices: params['devices'] is List
              ? params['devices'] as List<Object?>
              : const [],
        ),
      'stream/turn/created' => _turnCreated(
          params['turn'],
          threadId,
          params['clientTurnId'],
        ),
      'stream/approval/resolved' => ApprovalResolvedEvent(
          approvalId: params['approvalId'] is String
              ? params['approvalId'] as String
              : '',
          decision: params['decision'] is String
              ? params['decision'] as String
              : 'reject',
          timedOut: params['timedOut'] == true,
          threadId: threadId,
        ),
      'stream/question/resolved' => QuestionResolvedEvent(
          questionId: params['questionId'] is String
              ? params['questionId'] as String
              : '',
          answers: _answers(params['answers']),
          skipped: params['skipped'] == true,
          timedOut: params['timedOut'] == true,
          threadId: threadId,
        ),
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
  /// [beforeText] marks a block from a parallel/background activity that must
  /// be ordered before the open text run (see [ContentBlockEvent.beforeText]).
  DomainEvent _contentBlock(
    String turnId,
    String? threadId,
    Object? content, {
    bool beforeText = false,
  }) {
    if (content is Map) {
      final blockId = content['blockId'];
      return ContentBlockEvent(
        turnId: turnId,
        threadId: threadId,
        content: MessageContent.fromJson(content.cast<String, dynamic>()),
        beforeText: beforeText,
        blockId: blockId is String && blockId.isNotEmpty ? blockId : null,
      );
    }
    return const UnknownDomainEvent(method: 'stream/content/block');
  }

  /// Decodes `stream/thread/updated`; a payload without a usable thread (no
  /// string `id`) is dropped rather than upserted half-formed.
  DomainEvent _threadUpdated(Object? thread) {
    if (thread is Map && thread['id'] is String) {
      final json = thread.cast<String, dynamic>();
      return ThreadUpdatedEvent(thread: json, threadId: json['id'] as String);
    }
    return const UnknownDomainEvent(method: 'stream/thread/updated');
  }

  /// Decodes `stream/turn/created`; a turn without a string `id` is dropped.
  DomainEvent _turnCreated(
    Object? turn,
    String? threadId,
    Object? clientTurnId,
  ) {
    if (turn is Map && turn['id'] is String) {
      return TurnCreatedEvent(
        turn: turn.cast<String, dynamic>(),
        clientTurnId: clientTurnId is String ? clientTurnId : null,
        threadId: threadId,
      );
    }
    return const UnknownDomainEvent(method: 'stream/turn/created');
  }

  /// Reads the per-question chosen labels, dropping anything malformed.
  static List<List<String>> _answers(Object? value) {
    if (value is! List) return const [];
    return [
      for (final entry in value) _stringList(entry),
    ];
  }

  /// Maps a stream of inbound [source] messages to a stream of domain events.
  Stream<DomainEvent> bind(Stream<RpcMessage> source) => source.map(classify);

  /// Reads a list-of-strings field, tolerating a malformed payload (a garbled
  /// queue notification degrades to "the queue is empty", never to a crash).
  static List<String> _stringList(Object? value) {
    if (value is! List) return const [];
    return [
      for (final entry in value)
        if (entry is String) entry,
    ];
  }

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
