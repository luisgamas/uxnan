import 'dart:async';

import 'package:collection/collection.dart';
import 'package:rxdart/rxdart.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/repositories/i_message_repository.dart';
import 'package:uxnan/domain/repositories/i_thread_repository.dart';
import 'package:uxnan/domain/services/message_deduplicator.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/turn_timeline_snapshot.dart';

/// Sends a JSON-RPC request and resolves with the bridge response.
typedef RpcSend = Future<RpcMessage> Function(
  String method, [
  Map<String, dynamic>? params,
]);

/// Coordinates threads and the active conversation timeline (spec 02a §5.2.2).
///
/// Builds the active thread's [TurnTimelineSnapshot] from the local message
/// repository and applies streaming [DomainEvent]s (turn started / delta /
/// completed) to it via the snapshot reducer. Thread/turn loading goes through
/// the injected [RpcSend].
class ThreadManager {
  /// Creates a [ThreadManager].
  ThreadManager({
    required IThreadRepository threadRepository,
    required IMessageRepository messageRepository,
    required Stream<DomainEvent> domainEvents,
    required RpcSend sendRequest,
    Uuid? uuid,
    MessageDeduplicator? deduplicator,
  })  : _threadRepository = threadRepository,
        _messageRepository = messageRepository,
        _sendRequest = sendRequest,
        _uuid = uuid ?? const Uuid(),
        _deduplicator = deduplicator ?? MessageDeduplicator() {
    _eventsSub = domainEvents.listen(_applyEvent);
  }

  final IThreadRepository _threadRepository;
  final IMessageRepository _messageRepository;
  final RpcSend _sendRequest;
  final Uuid _uuid;
  final MessageDeduplicator _deduplicator;

  final BehaviorSubject<TurnTimelineSnapshot> _timeline =
      BehaviorSubject.seeded(const TurnTimelineSnapshot());
  String? _activeThreadId;
  StreamSubscription<List<Message>>? _messagesSub;
  late final StreamSubscription<DomainEvent> _eventsSub;

  /// Reactive list of threads.
  Stream<List<Thread>> get threadsStream => _threadRepository.watchThreads();

  /// The active thread's timeline (current value replayed on listen).
  Stream<TurnTimelineSnapshot> get timelineStream => _timeline.stream;

  /// The active thread's current timeline snapshot.
  TurnTimelineSnapshot get timeline => _timeline.value;

  /// The active thread id, if any.
  String? get activeThreadId => _activeThreadId;

  /// Loads the thread list from the bridge and persists it.
  Future<void> loadThreads({String? projectId, String? deviceId}) async {
    final response = await _sendRequest(
      'thread/list',
      projectId != null ? {'projectId': projectId} : null,
    );
    final result = response.result;
    if (result is! List) return;
    for (final raw in result) {
      if (raw is Map) {
        // Tag each synced thread with the PC it came from so the list can be
        // scoped to the selected device.
        final thread = _parseThread(raw.cast<String, dynamic>());
        await _threadRepository.saveThread(
          deviceId != null ? thread.copyWith(deviceId: deviceId) : thread,
        );
      }
    }
  }

  /// Loads the bridge's project list (`project/list`).
  Future<List<Project>> loadProjects() async {
    final response = await _sendRequest('project/list');
    final result = response.result;
    if (result is! List) return const [];
    return [
      for (final raw in result)
        if (raw is Map) Project.fromJson(raw.cast<String, dynamic>()),
    ];
  }

  /// Loads the bridge's agent list (`agent/list`).
  Future<List<AgentDescriptor>> loadAgents() async {
    final response = await _sendRequest('agent/list');
    final result = response.result;
    final agents = result is Map ? result['agents'] : null;
    if (agents is! List) return const [];
    return [
      for (final raw in agents)
        if (raw is Map) AgentDescriptor.fromJson(raw.cast<String, dynamic>()),
    ];
  }

  /// Loads the models the bridge reports for [agentId] (`agent/models`).
  Future<List<String>> loadModels(String agentId) async {
    final response = await _sendRequest('agent/models', {'agentId': agentId});
    final result = response.result;
    final models = result is Map ? result['models'] : null;
    if (models is! List) return const [];
    return [
      for (final raw in models)
        if (raw is String) raw,
    ];
  }

  /// Starts a new thread (`thread/start`) for [projectId], optionally overriding
  /// the agent/model/title/cwd, persists it locally and returns it.
  Future<Thread> startThread({
    required String projectId,
    String? title,
    String? agentId,
    String? model,
    String? cwd,
    String? deviceId,
  }) async {
    final response = await _sendRequest('thread/start', {
      'projectId': projectId,
      if (title != null && title.isNotEmpty) 'title': title,
      if (agentId != null) 'agentId': agentId,
      if (model != null && model.isNotEmpty) 'model': model,
      if (cwd != null && cwd.isNotEmpty) 'cwd': cwd,
    });
    final result = response.result;
    final json = result is Map ? result.cast<String, dynamic>() : null;
    final base = json != null
        ? _parseThread(json)
        : Thread(
            id: _uuid.v4(),
            title: title ?? projectId,
            agentId: agentId ?? 'custom',
            projectId: projectId,
            cwd: cwd,
            model: model,
            syncState: ThreadSyncState.synced,
            status: ThreadStatus.active,
            lastActivity: DateTime.now(),
          );
    final thread = deviceId != null ? base.copyWith(deviceId: deviceId) : base;
    await _threadRepository.saveThread(thread);
    return thread;
  }

  /// Selects [threadId] as active and (re)builds its timeline from local
  /// storage.
  Future<void> selectThread(String threadId) async {
    _activeThreadId = threadId;
    _deduplicator.reset();
    _timeline.add(const TurnTimelineSnapshot());
    await _messagesSub?.cancel();
    _messagesSub =
        _messageRepository.watchMessages(threadId).listen((messages) {
      final fresh =
          messages.where((m) => !_deduplicator.isDuplicate(m)).toList();
      _timeline.add(_timeline.value.reconcile(fresh));
    });
  }

  /// Saves a user [text] message locally and sends it to the active turn.
  Future<void> sendUserMessage(String threadId, String text) async {
    final message = Message(
      id: _uuid.v4(),
      threadId: threadId,
      turnId: '',
      role: MessageRole.user,
      contents: [TextContent(text)],
      deliveryState: MessageDeliveryState.sending,
      orderIndex: _nextOrderIndex(),
      createdAt: DateTime.now(),
    );
    await _messageRepository.saveMessage(message);
    // Bridge contract (TurnSendParams): { threadId, text, service?, effort? }.
    // `text` is required at the top level; nesting it under `content` made the
    // bridge reject the turn with invalid params, so no turn was created.
    await _sendRequest('turn/send', {
      'threadId': threadId,
      'text': text,
    });
  }

  /// Releases resources.
  Future<void> dispose() async {
    await _eventsSub.cancel();
    await _messagesSub?.cancel();
    await _timeline.close();
  }

  void _applyEvent(DomainEvent event) {
    final active = _activeThreadId;
    if (active == null) return;
    final eventThread = _threadOf(event);
    if (eventThread != null && eventThread != active) return;

    switch (event) {
      case TurnStartedEvent(:final turnId):
        final placeholder = Message(
          id: _streamId(turnId),
          threadId: active,
          turnId: turnId,
          role: MessageRole.assistant,
          contents: const [TextContent('', isStreaming: true)],
          deliveryState: MessageDeliveryState.delivered,
          orderIndex: _nextOrderIndex(),
          createdAt: DateTime.now(),
        );
        _timeline.add(_timeline.value.startStreaming(placeholder));
      case MessageDeltaEvent(:final turnId, :final delta):
        _timeline.add(_timeline.value.appendStreamingDelta(turnId, delta));
      case TurnCompletedEvent(:final turnId):
        final completed = _timeline.value.completeStreaming(turnId);
        _timeline.add(completed);
        final finalized = completed.messages
            .firstWhereOrNull((m) => m.id == _streamId(turnId));
        if (finalized != null) {
          unawaited(_messageRepository.saveMessage(finalized));
        }
      case TurnErrorEvent() || TurnAbortedEvent():
        final streamingTurn = _timeline.value.streamingTurnId;
        if (streamingTurn != null) {
          _timeline.add(_timeline.value.completeStreaming(streamingTurn));
        }
      case GitProgressEvent() || UnknownDomainEvent():
        break;
    }
  }

  String _streamId(String turnId) => 'stream-$turnId';

  int _nextOrderIndex() {
    final messages = _timeline.value.messages;
    return messages.isEmpty ? 0 : messages.last.orderIndex + 1;
  }

  static String? _threadOf(DomainEvent event) => switch (event) {
        TurnStartedEvent(:final threadId) => threadId,
        MessageDeltaEvent(:final threadId) => threadId,
        TurnCompletedEvent(:final threadId) => threadId,
        TurnErrorEvent(:final threadId) => threadId,
        TurnAbortedEvent(:final threadId) => threadId,
        GitProgressEvent(:final threadId) => threadId,
        UnknownDomainEvent() => null,
      };

  Thread _parseThread(Map<String, dynamic> json) {
    final lastActivity = json['lastActivity'];
    return Thread(
      id: json['id'] as String,
      title: json['title'] as String? ?? json['id'] as String,
      agentId: json['agentId'] as String? ?? 'custom',
      projectId: json['projectId'] as String?,
      cwd: json['cwd'] as String?,
      worktreePath: json['worktreePath'] as String?,
      model: json['model'] as String?,
      syncState: ThreadSyncState.synced,
      status: _parseStatus(json['status'] as String?),
      lastActivity: lastActivity is int
          ? DateTime.fromMillisecondsSinceEpoch(lastActivity)
          : null,
    );
  }

  static ThreadStatus _parseStatus(String? name) {
    for (final value in ThreadStatus.values) {
      if (value.name == name) return value;
    }
    return ThreadStatus.active;
  }
}
