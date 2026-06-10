import 'dart:async';
import 'dart:math';

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
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/repositories/i_message_repository.dart';
import 'package:uxnan/domain/repositories/i_thread_repository.dart';
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
  })  : _threadRepository = threadRepository,
        _messageRepository = messageRepository,
        _sendRequest = sendRequest,
        _uuid = uuid ?? const Uuid() {
    _eventsSub = domainEvents.listen(_applyEvent);
  }

  final IThreadRepository _threadRepository;
  final IMessageRepository _messageRepository;
  final RpcSend _sendRequest;
  final Uuid _uuid;

  final BehaviorSubject<TurnTimelineSnapshot> _timeline =
      BehaviorSubject.seeded(const TurnTimelineSnapshot());

  /// In-flight turn per thread, kept in memory so a streaming response survives
  /// leaving and re-entering the conversation screen (the manager is a
  /// singleton). The agent on the PC keeps running regardless; this just keeps
  /// the phone's view of it alive. Keyed by threadId.
  final Map<String, _LiveTurn> _live = {};

  /// Per-thread live activity (running/error), surfaced on the thread list so
  /// each card shows whether its conversation is currently working — even when
  /// its screen is closed. Idle threads are absent from the map.
  final BehaviorSubject<Map<String, ThreadActivity>> _activity =
      BehaviorSubject.seeded(const {});

  /// Latest persisted messages for the active thread (from the local repo),
  /// composed with any [_LiveTurn] overlay to build the active timeline.
  List<Message> _activePersisted = const [];

  /// Token usage of each thread's most recent turn (context occupied, and the
  /// model's window when known), reported via `turn/completed`. In memory only.
  final BehaviorSubject<Map<String, ({int tokens, int? contextWindow})>>
      _contextUsage = BehaviorSubject.seeded(const {});

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

  /// Map of threadId → live [ThreadActivity] (running/error), for the list.
  /// Idle threads are omitted from the map.
  Stream<Map<String, ThreadActivity>> get activityStream => _activity.stream;

  /// Map of threadId → most recent turn token usage (`tokens` occupied and the
  /// model `contextWindow` when known), for the context indicator.
  Stream<Map<String, ({int tokens, int? contextWindow})>>
      get contextUsageStream => _contextUsage.stream;

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

  /// Resolves (or creates) the project rooted at [cwd] (`project/resolve`), so
  /// a folder picked via the workspace browser can be started as a thread.
  Future<Project?> resolveProject(String cwd) async {
    final response = await _sendRequest('project/resolve', {'cwd': cwd});
    final result = response.result;
    return result is Map
        ? Project.fromJson(result.cast<String, dynamic>())
        : null;
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
    _live.remove(threadId);
    _setActivity(threadId, ThreadActivity.idle);
    if (_activeThreadId == threadId) {
      await _messagesSub?.cancel();
      _messagesSub = null;
      _activeThreadId = null;
      _activePersisted = const [];
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
    // The bridge MUST return the created thread (with its own id). Do NOT
    // fabricate a local id on failure: a phantom thread the bridge never
    // created makes every later turn/send fail with `thread not found`. Surface
    // the error instead so the new-conversation flow reports it.
    if (response.error != null) {
      throw StateError('thread/start failed: ${response.error!.message}');
    }
    final result = response.result;
    if (result is! Map) {
      throw StateError('thread/start returned no thread');
    }
    final base = _parseThread(result.cast<String, dynamic>());
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
  /// storage, overlaying any in-flight streaming turn (so a response that began
  /// while the screen was closed keeps rendering and updating live), then
  /// re-syncs the thread from the bridge to recover anything missed.
  Future<void> selectThread(String threadId) async {
    _activeThreadId = threadId;
    _activePersisted = const [];
    _timeline.add(const TurnTimelineSnapshot());
    await _messagesSub?.cancel();
    _messagesSub =
        _messageRepository.watchMessages(threadId).listen((messages) {
      _activePersisted = messages;
      _rebuildActiveTimeline();
    });
    // The bridge is the source of truth: pull its record so an answer that
    // completed while the app was away (and was never persisted locally) shows
    // up. Reconciled by the deterministic assistant id, so it never duplicates.
    unawaited(_resyncThread(threadId));
  }

  /// Pulls the bridge's turns for [threadId] (`turn/list`) and persists any
  /// assistant answer not already stored, keyed by the deterministic
  /// `stream-<turnId>` id. User messages are authored locally and persisted on
  /// send, so they are never re-synced (which would duplicate them).
  Future<void> _resyncThread(String threadId) async {
    final RpcMessage response;
    try {
      response = await _sendRequest('turn/list', {'threadId': threadId});
    } on Object catch (error, stackTrace) {
      AppLogger.warn('turn/list resync failed (kept local)', error, stackTrace);
      return;
    }
    final result = response.result;
    final turns = result is Map ? result['turns'] : null;
    if (turns is! List) return;

    final existing = await _messageRepository.getMessages(threadId);
    final byId = {for (final m in existing) m.id: m};
    var order = _maxOrder(existing);
    final toSave = <Message>[];
    for (final rawTurn in turns) {
      if (rawTurn is! Map) continue;
      final turnId = rawTurn['id'] as String?;
      final messages = rawTurn['messages'];
      if (turnId == null || messages is! List) continue;
      for (final rawMsg in messages) {
        if (rawMsg is! Map || rawMsg['role'] != 'assistant') continue;
        final content = rawMsg['content'];
        if (content is! String || content.isEmpty) continue;
        // Don't clobber a turn that is still streaming live on this device.
        if (_live[threadId]?.turnId == turnId) continue;
        final id = _streamId(turnId);
        final present = byId[id];
        if (present != null) {
          if (present.plainText != content) {
            toSave.add(
              present.copyWith(
                contents: [TextContent(content)],
                deliveryState: MessageDeliveryState.delivered,
              ),
            );
          }
          continue;
        }
        order += 1;
        toSave.add(
          Message(
            id: id,
            threadId: threadId,
            turnId: turnId,
            role: MessageRole.assistant,
            contents: [TextContent(content)],
            deliveryState: MessageDeliveryState.delivered,
            orderIndex: order,
            createdAt: _millisToDate(rawMsg['createdAt']),
          ),
        );
      }
    }
    if (toSave.isNotEmpty) await _messageRepository.saveMessages(toSave);
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
    // Surface failures: if the bridge rejects the turn (e.g. `thread not
    // found`), mark the user's message FAILED instead of swallowing it.
    try {
      final res = await _sendRequest('turn/send', {
        'threadId': threadId,
        'text': text,
      });
      if (res.error != null) {
        await _messageRepository.saveMessage(
          message.copyWith(deliveryState: MessageDeliveryState.failed),
        );
        AppLogger.warn('turn/send rejected: ${res.error!.message}');
      }
    } on Object catch (error, stackTrace) {
      await _messageRepository.saveMessage(
        message.copyWith(deliveryState: MessageDeliveryState.failed),
      );
      AppLogger.warn('turn/send failed', error, stackTrace);
    }
  }

  /// Releases resources.
  Future<void> dispose() async {
    await _eventsSub.cancel();
    await _messagesSub?.cancel();
    await _timeline.close();
    await _resolvedModels.close();
    await _activity.close();
    await _contextUsage.close();
  }

  /// Applies a streaming [event] for ANY thread (not just the active one): the
  /// in-flight turn is buffered per-thread and its activity recorded so the
  /// list reflects work happening off-screen, and the active timeline is
  /// rebuilt when the event belongs to it.
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

    // Events that don't carry their own threadId belong to the active thread
    // (the bridge tags turn notifications with threadId; deltas may not).
    final threadId = _threadOf(event) ?? _activeThreadId;
    if (threadId == null) return;

    switch (event) {
      case TurnStartedEvent(:final turnId):
        _live[threadId] = _LiveTurn(turnId: turnId);
        _setActivity(threadId, ThreadActivity.running);
        if (threadId == _activeThreadId) _rebuildActiveTimeline();
      case MessageDeltaEvent(:final turnId, :final delta):
        final live = _live[threadId];
        if (live != null && live.turnId == turnId) {
          live.text += delta;
          if (threadId == _activeThreadId) _rebuildActiveTimeline();
        }
      case TurnCompletedEvent(
          :final turnId,
          :final tokens,
          :final contextWindow,
        ):
        if (tokens != null) {
          final next = Map<String, ({int tokens, int? contextWindow})>.from(
            _contextUsage.value,
          );
          next[threadId] = (tokens: tokens, contextWindow: contextWindow);
          _contextUsage.add(next);
        }
        unawaited(_finishTurn(threadId, turnId, failed: false));
      case TurnErrorEvent(:final turnId):
        unawaited(_finishTurn(threadId, turnId, failed: true));
      case TurnAbortedEvent(:final turnId):
        unawaited(_finishTurn(threadId, turnId, failed: false));
      case GitProgressEvent() || ModelResolvedEvent() || UnknownDomainEvent():
        break;
    }
  }

  /// Finalizes a turn for [threadId]: persists the buffered assistant text
  /// (keyed by the deterministic id so it reconciles with a later re-sync),
  /// clears the live buffer and updates the thread's activity.
  Future<void> _finishTurn(
    String threadId,
    String turnId, {
    required bool failed,
  }) async {
    final live = _live.remove(threadId);
    _setActivity(threadId, failed ? ThreadActivity.error : ThreadActivity.idle);
    if (live == null) return;
    final finalized = Message(
      id: _streamId(turnId),
      threadId: threadId,
      turnId: turnId,
      role: MessageRole.assistant,
      contents: [TextContent(live.text)],
      deliveryState:
          failed ? MessageDeliveryState.failed : MessageDeliveryState.delivered,
      orderIndex: await _orderIndexFor(threadId),
      createdAt: live.startedAt,
    );
    if (threadId == _activeThreadId) {
      // Reflect immediately so the bubble doesn't flicker out before the repo
      // round-trip emits it back.
      _activePersisted = _upsert(_activePersisted, finalized);
      _rebuildActiveTimeline();
    }
    await _messageRepository.saveMessage(finalized);
  }

  /// Rebuilds the active timeline from persisted messages plus any in-flight
  /// streaming overlay from the live buffer.
  void _rebuildActiveTimeline() {
    final threadId = _activeThreadId;
    if (threadId == null) return;
    var snapshot = const TurnTimelineSnapshot().reconcile(_activePersisted);
    final live = _live[threadId];
    if (live != null) {
      final streaming = Message(
        id: _streamId(live.turnId),
        threadId: threadId,
        turnId: live.turnId,
        role: MessageRole.assistant,
        contents: [TextContent(live.text, isStreaming: true)],
        deliveryState: MessageDeliveryState.delivered,
        orderIndex: _maxOrder(_activePersisted) + 1,
        createdAt: live.startedAt,
      );
      snapshot = snapshot
          .reconcile([streaming]).copyWith(streamingTurnId: live.turnId);
    }
    _timeline.add(snapshot);
  }

  void _setActivity(String threadId, ThreadActivity activity) {
    final next = Map<String, ThreadActivity>.from(_activity.value);
    if (activity == ThreadActivity.idle) {
      next.remove(threadId);
    } else {
      next[threadId] = activity;
    }
    _activity.add(next);
  }

  Future<int> _orderIndexFor(String threadId) async {
    if (threadId == _activeThreadId) return _maxOrder(_activePersisted) + 1;
    final existing = await _messageRepository.getMessages(threadId);
    return _maxOrder(existing) + 1;
  }

  static int _maxOrder(List<Message> messages) =>
      messages.isEmpty ? -1 : messages.map((m) => m.orderIndex).reduce(max);

  static List<Message> _upsert(List<Message> messages, Message message) {
    final next = [
      for (final m in messages)
        if (m.id != message.id) m,
      message,
    ]..sort((a, b) => a.orderIndex.compareTo(b.orderIndex));
    return next;
  }

  static DateTime _millisToDate(Object? raw) =>
      raw is int ? DateTime.fromMillisecondsSinceEpoch(raw) : DateTime.now();

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

/// A turn streaming in memory for one thread. Survives leaving the conversation
/// screen because the [ThreadManager] is a singleton; the agent on the PC keeps
/// running either way.
class _LiveTurn {
  _LiveTurn({required this.turnId}) : startedAt = DateTime.now();

  final String turnId;
  final DateTime startedAt;
  String text = '';
}
