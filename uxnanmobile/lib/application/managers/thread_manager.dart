import 'dart:async';

import 'package:collection/collection.dart';
import 'package:rxdart/rxdart.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
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

  /// Concrete model each thread's agent resolved its alias to most recently
  /// (e.g. `opus` → `claude-opus-4-8`), reported via `stream/model/resolved`.
  /// Kept in memory only: re-derived on the next turn, never persisted.
  final BehaviorSubject<Map<String, String>> _resolvedModels =
      BehaviorSubject.seeded(const {});
  String? _activeThreadId;
  StreamSubscription<List<Message>>? _messagesSub;
  late final StreamSubscription<DomainEvent> _eventsSub;

  /// Reactive list of threads.
  Stream<List<Thread>> get threadsStream => _threadRepository.watchThreads();

  /// The active thread's timeline (current value replayed on listen).
  Stream<TurnTimelineSnapshot> get timelineStream => _timeline.stream;

  /// Map of threadId → concrete resolved model id (current value replayed).
  Stream<Map<String, String>> get resolvedModelsStream =>
      _resolvedModels.stream;

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

  /// Changes the model a thread's agent uses (`thread/setModel`) and mirrors it
  /// locally so the conversation reflects it immediately.
  Future<void> setThreadModel(String threadId, String model) async {
    await _sendRequest('thread/setModel', {
      'threadId': threadId,
      'model': model,
    });
    final thread = await _threadRepository.getThread(threadId);
    if (thread != null) {
      await _threadRepository.saveThread(thread.copyWith(model: model));
    }
  }

  /// Renames a thread (`thread/rename`), mirroring the new title locally first
  /// so the UI updates immediately. The bridge call is best-effort: it degrades
  /// gracefully (keeping the local rename) when the bridge does not yet
  /// implement the method.
  Future<void> renameThread(String threadId, String title) async {
    final trimmed = title.trim();
    if (trimmed.isEmpty) return;
    final thread = await _threadRepository.getThread(threadId);
    if (thread != null) {
      await _threadRepository.saveThread(thread.copyWith(title: trimmed));
    }
    try {
      await _sendRequest('thread/rename', {
        'threadId': threadId,
        'title': trimmed,
      });
    } on Object catch (error, stackTrace) {
      AppLogger.warn(
        'thread/rename failed (kept local rename)',
        error,
        stackTrace,
      );
    }
  }

  /// Deletes a thread (`thread/delete`), removing it locally first. Clears the
  /// active timeline if the deleted thread was active. The bridge call is
  /// best-effort and degrades gracefully if unsupported (a later `loadThreads`
  /// would re-sync it from the bridge until then).
  Future<void> deleteThread(String threadId) async {
    await _threadRepository.deleteThread(threadId);
    if (_activeThreadId == threadId) {
      await _messagesSub?.cancel();
      _messagesSub = null;
      _activeThreadId = null;
      _timeline.add(const TurnTimelineSnapshot());
    }
    try {
      await _sendRequest('thread/delete', {'threadId': threadId});
    } on Object catch (error, stackTrace) {
      AppLogger.warn(
        'thread/delete failed (removed locally)',
        error,
        stackTrace,
      );
    }
  }

  /// Archives a thread (`thread/archive`): sets its local status to
  /// [ThreadStatus.archived] first (so it leaves the active list immediately),
  /// then calls the bridge best-effort. Nothing is deleted — the thread stays
  /// in local storage and can be restored with [unarchiveThread]. Degrades
  /// gracefully when the bridge does not implement the method.
  Future<void> archiveThread(String threadId) =>
      _setArchived(threadId, archived: true, method: 'thread/archive');

  /// Restores an archived thread (`thread/unarchive`): sets its local status
  /// back to [ThreadStatus.active], then calls the bridge best-effort.
  Future<void> unarchiveThread(String threadId) =>
      _setArchived(threadId, archived: false, method: 'thread/unarchive');

  Future<void> _setArchived(
    String threadId, {
    required bool archived,
    required String method,
  }) async {
    final thread = await _threadRepository.getThread(threadId);
    if (thread != null) {
      await _threadRepository.saveThread(
        thread.copyWith(
          status: archived ? ThreadStatus.archived : ThreadStatus.active,
        ),
      );
    }
    try {
      await _sendRequest(method, {'threadId': threadId});
    } on Object catch (error, stackTrace) {
      AppLogger.warn('$method failed (kept local change)', error, stackTrace);
    }
  }

  /// Loads the models the bridge reports for [agentId] (`agent/models`).
  ///
  /// Tolerates both the structured contract (objects with displayName/version/
  /// description/isDefault) and legacy bridges that report bare id strings.
  Future<List<AgentModel>> loadModels(String agentId) async {
    final response = await _sendRequest('agent/models', {'agentId': agentId});
    final result = response.result;
    final models = result is Map ? result['models'] : null;
    if (models is! List) return const [];
    return [
      for (final raw in models)
        if (AgentModel.fromAny(raw) case final model?) model,
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
    // Auto-title: when the user did not name the thread, default its title to
    // the thread's own id so it is identifiable in the list and resumable from
    // the CLI on the PC. The user can rename it afterwards.
    final hasUserTitle = title != null && title.trim().isNotEmpty;
    final titled = hasUserTitle ? base : base.copyWith(title: base.id);
    final thread =
        deviceId != null ? titled.copyWith(deviceId: deviceId) : titled;
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
    await _resolvedModels.close();
  }

  void _applyEvent(DomainEvent event) {
    // Resolved-model updates are keyed by their own thread and recorded
    // regardless of which thread is active in the UI.
    if (event case ModelResolvedEvent(:final threadId, :final model)
        when threadId != null && model.isNotEmpty) {
      final next = Map<String, String>.from(_resolvedModels.value)
        ..[threadId] = model;
      _resolvedModels.add(next);
      return;
    }

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
      case GitProgressEvent() || ModelResolvedEvent() || UnknownDomainEvent():
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
        ModelResolvedEvent(:final threadId) => threadId,
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
