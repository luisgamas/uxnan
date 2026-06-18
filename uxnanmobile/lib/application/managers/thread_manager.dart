import 'dart:async';
import 'dart:math';

import 'package:rxdart/rxdart.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/auth_status.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
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
    String? Function()? foregroundThreadId,
    Uuid? uuid,
  })  : _threadRepository = threadRepository,
        _messageRepository = messageRepository,
        _sendRequest = sendRequest,
        _foregroundThreadId = foregroundThreadId,
        _uuid = uuid ?? const Uuid() {
    _eventsSub = domainEvents.listen(_applyEvent);
  }

  final IThreadRepository _threadRepository;
  final IMessageRepository _messageRepository;
  final RpcSend _sendRequest;

  /// Returns the threadId of the conversation the user is currently viewing in
  /// the foreground (null when none). A reply that lands in a thread the user
  /// is NOT viewing is marked unread.
  final String? Function()? _foregroundThreadId;

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

  /// Thread ids with an unread agent reply (a turn completed while the user was
  /// not viewing that conversation). Cleared when the conversation is opened.
  /// In memory only (resets on restart).
  final BehaviorSubject<Set<String>> _unread = BehaviorSubject.seeded(const {});

  /// Latest persisted messages for the active thread (from the local repo),
  /// composed with any [_LiveTurn] overlay to build the active timeline.
  List<Message> _activePersisted = const [];

  /// One page of timeline history (messages rendered per local window step).
  static const int _historyPageSize = 40;

  /// One page of remote history (turns fetched per `turn/list` call). Matches
  /// the bridge's default turn limit so a page maps to one bridge slice.
  static const int _turnPageSize = 20;

  /// How many of the most-recent persisted messages the active timeline
  /// renders. The local store holds the pages fetched so far; this bounds the
  /// rendered window so a long history doesn't build thousands of widgets at
  /// once, and grows by a page when the user scrolls to the top
  /// ([loadMoreHistory]).
  int _renderLimit = _historyPageSize;

  /// Turn-index offset of the oldest turn fetched so far for the active thread.
  /// `0` once the whole thread has been pulled (or on an older bridge that
  /// doesn't report `total`, disabling remote back-paging); `> 0` means older
  /// turns remain on the bridge and can be paged in by [loadMoreHistory].
  int _remoteOldestOffset = 0;

  /// `true` while an older-page `turn/list` fetch is in flight, so a double tap
  /// on "show earlier" doesn't fire two overlapping fetches.
  bool _loadingOlder = false;

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

  /// Set of thread ids with an unread agent reply, for the list's unread style.
  Stream<Set<String>> get unreadStream => _unread.stream;

  /// Clears the unread flag for [threadId] (the user opened/returned to it).
  void markRead(String threadId) {
    if (!_unread.value.contains(threadId)) return;
    _unread.add({..._unread.value}..remove(threadId));
  }

  void _markUnread(String threadId) {
    if (_unread.value.contains(threadId)) return;
    _unread.add({..._unread.value, threadId});
  }

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

  /// Resumes [threadId] on the bridge (`thread/resume`) so its agent session can
  /// continue a conversation that had gone idle; flips the local status back to
  /// active. Best-effort — degrades gracefully against an older bridge.
  Future<void> resumeThread(String threadId) async {
    final thread = await _threadRepository.getThread(threadId);
    // Don't reactivate a thread the user archived on purpose (merely opening it
    // to read should not un-archive it).
    if (thread?.status == ThreadStatus.archived) return;
    if (thread != null && thread.status != ThreadStatus.active) {
      await _threadRepository.saveThread(
        thread.copyWith(status: ThreadStatus.active),
      );
    }
    try {
      await _sendRequest('thread/resume', {'threadId': threadId});
    } on Object catch (error, stackTrace) {
      AppLogger.warn('thread/resume failed (kept local)', error, stackTrace);
    }
  }

  /// Whether [cwd] still exists on the bridge (`workspace/exists`). A thread's
  /// folder or worktree can be removed outside the app, leaving its `cwd` dead.
  /// Fail-open: returns true on a transient error or an older bridge, so the
  /// composer is only disabled on a confirmed-vanished cwd.
  Future<bool> workspaceExists(String cwd) async {
    try {
      final res = await _sendRequest('workspace/exists', {'cwd': cwd});
      if (res.error != null) return true;
      final result = res.result;
      if (result is Map && result['exists'] is bool) {
        return result['exists'] as bool;
      }
      return true;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('workspace/exists failed', error, stackTrace);
      return true;
    }
  }

  /// Reads the bridge record for [threadId] (`thread/read`) and returns the
  /// agent's native session id (Claude `session_id`, OpenCode `sessionID`, …),
  /// or `null` when unknown / unsupported / offline. Lets the conversation show
  /// "resume from the CLI" beyond the bridge thread id. Failures degrade to
  /// `null` rather than surfacing an error.
  Future<String?> readAgentSessionId(String threadId) async {
    try {
      final res = await _sendRequest('thread/read', {'threadId': threadId});
      if (res.error != null) return null;
      final result = res.result;
      if (result is Map) {
        final id = result['agentSessionId'];
        if (id is String && id.isNotEmpty) return id;
      }
      return null;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('thread/read failed', error, stackTrace);
      return null;
    }
  }

  /// Reads the persisted per-thread access (approval) mode from the bridge
  /// (`thread/read`), or `null` when unknown / unsupported / offline — so the
  /// conversation can seed its mode from the server (the source of truth) on
  /// open. Failures degrade to `null` (keep the local default).
  Future<ApprovalMode?> readAccessMode(String threadId) async {
    try {
      final res = await _sendRequest('thread/read', {'threadId': threadId});
      if (res.error != null) return null;
      final result = res.result;
      if (result is Map) {
        final raw = result['accessMode'];
        if (raw is String) {
          for (final mode in ApprovalMode.values) {
            if (mode.name == raw) return mode;
          }
        }
      }
      return null;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('thread/read accessMode failed', error, stackTrace);
      return null;
    }
  }

  /// Persists the per-thread access (approval) [mode] on the bridge
  /// (`thread/setAccessMode`) so the choice survives a restart and is shared
  /// across devices. Best-effort: failures (offline / older bridge) are
  /// swallowed so the local UI choice still applies this session.
  Future<void> setAccessMode(String threadId, ApprovalMode mode) async {
    try {
      await _sendRequest('thread/setAccessMode', {
        'threadId': threadId,
        'mode': mode.name,
      });
    } on Object catch (error, stackTrace) {
      AppLogger.warn('thread/setAccessMode failed', error, stackTrace);
    }
  }

  /// Forks [threadId] on the bridge (`thread/fork`): the bridge deep-copies the
  /// thread and its turns into a new thread, which is persisted locally
  /// (inheriting the source's `deviceId`) and returned so the caller can open
  /// it. Returns null when the bridge rejects it (e.g. no fork support).
  Future<Thread?> forkThread(String threadId, {String? newBranch}) async {
    final RpcMessage response;
    try {
      response = await _sendRequest('thread/fork', {
        'threadId': threadId,
        if (newBranch != null && newBranch.isNotEmpty) 'newBranch': newBranch,
      });
    } on Object catch (error, stackTrace) {
      AppLogger.warn('thread/fork failed', error, stackTrace);
      return null;
    }
    if (response.error != null) {
      AppLogger.warn('thread/fork rejected: ${response.error!.message}');
      return null;
    }
    final result = response.result;
    if (result is! Map) return null;
    final source = await _threadRepository.getThread(threadId);
    final forked = _parseThread(result.cast<String, dynamic>());
    final tagged = source?.deviceId != null
        ? forked.copyWith(deviceId: source!.deviceId)
        : forked;
    await _threadRepository.saveThread(tagged);
    return tagged;
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

  /// Loads the sanitized auth status the bridge reports for [agentId]
  /// (`auth/status`), or null when the bridge does not answer with a status
  /// (e.g. an older bridge that left the method unimplemented). The result
  /// never carries tokens — it only says whether the agent needs a login on
  /// the PC. Used to surface a "requires login" banner.
  Future<AuthStatus?> loadAuthStatus(String agentId) async {
    final response = await _sendRequest('auth/status', {'agentId': agentId});
    final result = response.result;
    return result is Map
        ? AuthStatus.fromJson(result.cast<String, dynamic>())
        : null;
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
    String? worktreePath,
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
    var thread =
        deviceId != null ? titled.copyWith(deviceId: deviceId) : titled;
    // The bridge doesn't track the worktree, so persist the path the app
    // created it at — this surfaces the "Remove worktree" action.
    if (worktreePath != null && worktreePath.isNotEmpty) {
      thread = thread.copyWith(worktreePath: worktreePath);
    }
    await _threadRepository.saveThread(thread);
    return thread;
  }

  /// Selects [threadId] as active and (re)builds its timeline from local
  /// storage, overlaying any in-flight streaming turn (so a response that began
  /// while the screen was closed keeps rendering and updating live), then
  /// re-syncs the thread from the bridge to recover anything missed.
  Future<void> selectThread(String threadId) async {
    _activeThreadId = threadId;
    markRead(threadId); // opening the conversation clears its unread flag
    _activePersisted = const [];
    _renderLimit = _historyPageSize; // reset the window for the new thread
    _remoteOldestOffset = 0; // reset remote paging state for the new thread
    _loadingOlder = false;
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

  /// Loads one page of older history. First grows the rendered window over
  /// already-fetched messages; once the local store is exhausted it pulls the
  /// previous page of turns from the bridge (`turn/list` with an explicit
  /// offset cursor derived from the reported `total`), persists them and grows
  /// the window so they show. No-op when nothing older remains, locally or
  /// remotely. On an older bridge that doesn't report `total`, remote paging is
  /// disabled and this only grows the local window (prior behaviour).
  Future<void> loadMoreHistory() async {
    final threadId = _activeThreadId;
    if (threadId == null) return;
    // 1) Reveal already-fetched older messages by widening the window first.
    if (_renderLimit < _activePersisted.length) {
      _renderLimit += _historyPageSize;
      _rebuildActiveTimeline();
      return;
    }
    // 2) Local store exhausted — pull the previous page of turns, if any.
    if (_loadingOlder || _remoteOldestOffset <= 0) return;
    _loadingOlder = true;
    try {
      final size = _remoteOldestOffset < _turnPageSize
          ? _remoteOldestOffset
          : _turnPageSize;
      final start = _remoteOldestOffset - size;
      final page = await _fetchTurns(threadId, cursor: '$start', limit: size);
      if (threadId != _activeThreadId || page == null) return;
      await _persistTurns(
        threadId,
        page.turns,
        trackLatestUsage: false,
        olderPage: true,
      );
      _remoteOldestOffset = start;
      // Widen the window so the just-fetched older messages are visible.
      _renderLimit += _historyPageSize;
      _rebuildActiveTimeline();
    } finally {
      _loadingOlder = false;
    }
  }

  /// Pulls the bridge's **newest** page of turns for [threadId] (`turn/list`
  /// with `fromEnd`) and persists any assistant answer not already stored,
  /// keyed by the deterministic `stream-<turnId>` id. Opening a long thread no
  /// longer re-pulls the whole history — older pages load on demand via
  /// [loadMoreHistory]. User messages are authored locally and persisted on
  /// send, so they are never re-synced (which would duplicate them).
  Future<void> _resyncThread(String threadId) async {
    final page =
        await _fetchTurns(threadId, limit: _turnPageSize, fromEnd: true);
    if (page == null) return;
    await _persistTurns(threadId, page.turns, trackLatestUsage: true);
    if (threadId != _activeThreadId) return;
    final total = page.total;
    if (total == null) {
      // Older bridge without `total`: no remote back-paging, fall back to local
      // windowing over whatever this page returned.
      _remoteOldestOffset = 0;
    } else {
      // The fetched page is the last `turns.length` turns, so older turns live
      // below this offset.
      final offset = total - page.turns.length;
      _remoteOldestOffset = offset < 0 ? 0 : offset;
    }
    _rebuildActiveTimeline();
  }

  /// Sends `turn/list` for one page and returns its turns + reported `total`
  /// (null on failure or an older bridge). [fromEnd] asks for the newest page;
  /// otherwise [cursor] is an explicit offset.
  Future<({List<Object?> turns, int? total})?> _fetchTurns(
    String threadId, {
    String? cursor,
    int? limit,
    bool fromEnd = false,
  }) async {
    final params = <String, dynamic>{'threadId': threadId};
    if (cursor != null) params['cursor'] = cursor;
    if (limit != null) params['limit'] = limit;
    if (fromEnd) params['fromEnd'] = true;
    final RpcMessage response;
    try {
      response = await _sendRequest('turn/list', params);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('turn/list resync failed (kept local)', error, stackTrace);
      return null;
    }
    final result = response.result;
    if (result is! Map) return null;
    final turns = result['turns'];
    if (turns is! List) return null;
    final total = result['total'];
    return (turns: turns, total: total is int ? total : null);
  }

  /// Persists the assistant answers from a fetched page of [turns] into the
  /// local store (reconciling against any already-stored copy by the
  /// deterministic `stream-<turnId>` id). When [trackLatestUsage] is true the
  /// last turn's token usage restores the context meter (only meaningful for
  /// the newest page).
  Future<void> _persistTurns(
    String threadId,
    List<Object?> turns, {
    required bool trackLatestUsage,
    bool olderPage = false,
  }) async {
    final existing = await _messageRepository.getMessages(threadId);
    final byId = {for (final m in existing) m.id: m};
    final toSave = <Message>[];
    // New (not-yet-stored) messages collected in document order (oldest→newest);
    // their `orderIndex` is assigned after the loop so an older page lands
    // *below* the current minimum (it's older) and the newest page *above* the
    // maximum, keeping the ascending-by-orderIndex timeline chronological.
    final pending = <Message>[];
    // The latest turn's usage (turns are in order) restores the context meter
    // on re-open — it lives in memory only, so leaving and returning resets it.
    ({int tokens, int? contextWindow})? latestUsage;
    for (final rawTurn in turns) {
      if (rawTurn is! Map) continue;
      final turnId = rawTurn['id'] as String?;
      final messages = rawTurn['messages'];
      if (turnId == null || messages is! List) continue;
      for (final rawMsg in messages) {
        if (rawMsg is! Map || rawMsg['role'] != 'assistant') continue;
        final content = rawMsg['content'];
        if (content is! String || content.isEmpty) continue;
        final thinking =
            rawMsg['thinking'] is String ? rawMsg['thinking'] as String : '';
        final blocks = _decodeBlocks(rawMsg['blocks']);
        final usage = _parseUsage(rawMsg['usage']);
        if (usage != null) latestUsage = usage;
        // Don't clobber a turn that is still streaming live on this device.
        if (_live[threadId]?.turnId == turnId) continue;
        final id = _streamId(turnId);
        final contents =
            _assistantContents(content, thinking, blocks, streaming: false);
        final present = byId[id];
        if (present != null) {
          // Compare text + thinking + block count (plainText omits both), so a
          // turn whose reasoning/blocks arrived only via history is reconciled.
          final presentText = present.contents
              .whereType<TextContent>()
              .map((t) => t.text)
              .join();
          final presentThinking = present.contents
              .whereType<ThinkingContent>()
              .map((t) => t.text)
              .join();
          final presentBlocks = present.contents
              .where((c) => c is! TextContent && c is! ThinkingContent)
              .length;
          if (presentText != content ||
              presentThinking != thinking ||
              presentBlocks != blocks.length) {
            toSave.add(
              present.copyWith(
                contents: contents,
                deliveryState: MessageDeliveryState.delivered,
              ),
            );
          }
          continue;
        }
        pending.add(
          Message(
            id: id,
            threadId: threadId,
            turnId: turnId,
            role: MessageRole.assistant,
            contents: contents,
            deliveryState: MessageDeliveryState.delivered,
            orderIndex: 0, // assigned below, relative to the existing window
            createdAt: _millisToDate(rawMsg['createdAt']),
          ),
        );
      }
    }
    // Assign order indices: an older page sits below the current minimum, the
    // newest page above the current maximum. Both keep the page's own
    // oldest→newest order.
    if (pending.isNotEmpty) {
      final base = olderPage
          ? _minOrder(existing) - pending.length
          : _maxOrder(existing) + 1;
      for (var i = 0; i < pending.length; i += 1) {
        toSave.add(pending[i].copyWith(orderIndex: base + i));
      }
    }
    if (toSave.isNotEmpty) await _messageRepository.saveMessages(toSave);
    // Restore the context meter from the latest turn's stored usage, unless a
    // live turn already set a fresher value for this thread. Only the newest
    // page carries the *current* usage — older pages must never overwrite it.
    if (trackLatestUsage &&
        latestUsage != null &&
        !_contextUsage.value.containsKey(threadId)) {
      final next = Map<String, ({int tokens, int? contextWindow})>.from(
        _contextUsage.value,
      )..[threadId] = latestUsage;
      _contextUsage.add(next);
    }
  }

  /// Parses a wire `usage` map (`{ tokens, contextWindow? }`) from `turn/list`.
  static ({int tokens, int? contextWindow})? _parseUsage(Object? raw) {
    if (raw is! Map) return null;
    final tokens = raw['tokens'];
    if (tokens is! int) return null;
    final window = raw['contextWindow'];
    return (tokens: tokens, contextWindow: window is int ? window : null);
  }

  /// Saves a user [text] message locally and sends it to the active turn.
  /// [attachments] are inline images (base64) picked in the composer; they are
  /// echoed in the local message and ride on `turn/send`.
  Future<void> sendUserMessage(
    String threadId,
    String text, {
    Map<String, Object>? options,
    List<ImageContent>? attachments,
  }) async {
    final images = attachments ?? const <ImageContent>[];
    final contents = <MessageContent>[
      if (text.isNotEmpty) TextContent(text),
      ...images,
    ];
    if (contents.isEmpty) return;
    final message = Message(
      id: _uuid.v4(),
      threadId: threadId,
      turnId: '',
      role: MessageRole.user,
      contents: contents,
      deliveryState: MessageDeliveryState.sending,
      orderIndex: _nextOrderIndex(),
      createdAt: DateTime.now(),
    );
    await _messageRepository.saveMessage(message);
    // Bridge contract (TurnSendParams): { threadId, text, service?, effort?,
    // options? }. `text` is required at the top level; nesting it under
    // `content` made the bridge reject the turn with invalid params, so no turn
    // was created. `options` carries the chosen per-model run-option knobs.
    // Surface failures: if the bridge rejects the turn (e.g. `thread not
    // found`), mark the user's message FAILED instead of swallowing it.
    //
    // FOR-DEV: `attachments` is sent ahead of the bridge — `TurnSendParams` has
    // no attachments field yet and `AgentManager.sendTurn` doesn't forward
    // images, so the agent does not receive them until the bridge wires it (the
    // local echo already shows the image). See `FOR-DEV.md` for the contract.
    try {
      final res = await _sendRequest('turn/send', {
        'threadId': threadId,
        'text': text,
        if (options != null && options.isNotEmpty) 'options': options,
        if (images.isNotEmpty)
          'attachments': [for (final image in images) image.toJson()],
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

  /// Responds to a pending approval ([approvalId]) on [threadId] with
  /// [decision], via `turn/send { approvalResponse }`. Returns true when the
  /// bridge accepts it. No local message is created — the response is control
  /// data, not chat.
  ///
  /// FOR-DEV: the bridge does NOT yet emit approval requests nor accept
  /// `approvalResponse` (the Claude adapter runs headless, Echo has
  /// `approvals:false`). Wired ahead of the bridge against the documented
  /// contract — see `FOR-DEV.md`; dormant until the bridge counterpart lands.
  Future<bool> respondApproval({
    required String threadId,
    required String approvalId,
    required ApprovalDecision decision,
  }) async {
    try {
      final res = await _sendRequest('turn/send', {
        'threadId': threadId,
        'approvalResponse': {
          'approvalId': approvalId,
          'decision': decision.wireName,
        },
      });
      if (res.error != null) {
        AppLogger.warn('approval response rejected: ${res.error!.message}');
        return false;
      }
      return true;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('approval response failed', error, stackTrace);
      return false;
    }
  }

  /// Cancels the in-flight turn for [threadId] (`turn/cancel`) without closing
  /// the thread — e.g. the user hit Send by mistake and wants to stop the agent
  /// and rewrite. The bridge aborts the run and emits `stream/turn/aborted`,
  /// which finalizes the partial turn locally. No-op if nothing is streaming.
  Future<void> cancelTurn(String threadId) async {
    final turnId = _live[threadId]?.turnId;
    if (turnId == null) return;
    try {
      await _sendRequest('turn/cancel', {
        'threadId': threadId,
        'turnId': turnId,
      });
    } on Object catch (error, stackTrace) {
      AppLogger.warn('turn/cancel failed', error, stackTrace);
    }
  }

  /// Releases resources.
  Future<void> dispose() async {
    await _eventsSub.cancel();
    await _messagesSub?.cancel();
    await _timeline.close();
    await _resolvedModels.close();
    await _activity.close();
    await _unread.close();
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
          live.appendText(delta);
          if (threadId == _activeThreadId) _rebuildActiveTimeline();
        }
      case ThinkingDeltaEvent(:final turnId, :final delta):
        final live = _live[threadId];
        if (live != null && live.turnId == turnId) {
          live.thinking += delta;
          if (threadId == _activeThreadId) _rebuildActiveTimeline();
        }
      case ContentBlockEvent(:final turnId, :final content):
        final live = _live[threadId];
        if (live != null && live.turnId == turnId) {
          live.segments.add(content);
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
        // A reply landing in a thread the user isn't viewing is unread.
        if (threadId != _foregroundThreadId?.call()) _markUnread(threadId);
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
      contents: _assistantContentsOrdered(
        live.thinking,
        live.segments,
        streaming: false,
      ),
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
    // Render only the most-recent window; older history loads on scroll-to-top.
    final all = _activePersisted;
    final localHasMore = all.length > _renderLimit;
    // More history is available when the local window hides older messages OR
    // the bridge still holds older turns we haven't paged in yet.
    final hasMore = localHasMore || _remoteOldestOffset > 0;
    final windowed =
        localHasMore ? all.sublist(all.length - _renderLimit) : all;
    var snapshot = const TurnTimelineSnapshot().reconcile(windowed).copyWith(
          hasMore: hasMore,
        );
    final live = _live[threadId];
    if (live != null) {
      final streaming = Message(
        id: _streamId(live.turnId),
        threadId: threadId,
        turnId: live.turnId,
        role: MessageRole.assistant,
        contents: _assistantContentsOrdered(
          live.thinking,
          live.segments,
          streaming: true,
        ),
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

  static int _minOrder(List<Message> messages) =>
      messages.isEmpty ? 0 : messages.map((m) => m.orderIndex).reduce(min);

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

  /// Decodes the wire `blocks` array (structured MessageContent JSON) from a
  /// `turn/list` message into content blocks; tolerant of missing/malformed.
  static List<MessageContent> _decodeBlocks(Object? raw) {
    if (raw is! List) return const [];
    return [
      for (final block in raw)
        if (block is Map)
          MessageContent.fromJson(block.cast<String, dynamic>()),
    ];
  }

  /// Builds an assistant message's content blocks from its answer [text],
  /// optional [thinking] and any structured [blocks] (commands/diffs/tools).
  /// Used for the **history** path (`turn/list`), which carries the full text
  /// and the blocks separately with no interleave position — so blocks sit
  /// before the text. AssistantTurnView re-groups blocks into the Work log /
  /// Changed files sections regardless of their position here.
  // FOR-DEV: a turn loaded purely from history (never streamed live on this
  // device) can't interleave the work log with the response because the wire
  // `blocks` array carries no per-block text offset. Live/persisted turns do
  // interleave (see `_assistantContentsOrdered`); aligning history would need
  // the bridge to emit blocks and text in one ordered stream.
  static List<MessageContent> _assistantContents(
    String text,
    String thinking,
    List<MessageContent> blocks, {
    required bool streaming,
  }) {
    return [
      if (thinking.isNotEmpty)
        ThinkingContent(thinking, isStreaming: streaming),
      ...blocks,
      TextContent(text, isStreaming: streaming),
    ];
  }

  /// Builds an assistant message's contents from the live turn's ordered
  /// [segments] (text runs + blocks as they streamed), keeping the work log
  /// **interleaved** with the response. The last text run carries the
  /// [streaming] flag (so `Message.isStreaming` stays true); when streaming
  /// with no text yet, an empty streaming run is appended to keep the activity
  /// cue alive. The text runs concatenate to the same full answer the history
  /// reports, so a later `turn/list` re-sync reconciles without clobbering the
  /// interleaved order.
  static List<MessageContent> _assistantContentsOrdered(
    String thinking,
    List<MessageContent> segments, {
    required bool streaming,
  }) {
    var lastText = -1;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i] is TextContent) lastText = i;
    }
    final out = <MessageContent>[
      if (thinking.isNotEmpty)
        ThinkingContent(thinking, isStreaming: streaming),
    ];
    for (var i = 0; i < segments.length; i++) {
      final seg = segments[i];
      if (seg is TextContent) {
        out.add(
          TextContent(seg.text, isStreaming: streaming && i == lastText),
        );
      } else {
        out.add(seg);
      }
    }
    if (streaming && lastText == -1) {
      out.add(const TextContent('', isStreaming: true));
    }
    return out;
  }

  int _nextOrderIndex() {
    final messages = _timeline.value.messages;
    return messages.isEmpty ? 0 : messages.last.orderIndex + 1;
  }

  static String? _threadOf(DomainEvent event) => switch (event) {
        TurnStartedEvent(:final threadId) => threadId,
        MessageDeltaEvent(:final threadId) => threadId,
        ThinkingDeltaEvent(:final threadId) => threadId,
        ContentBlockEvent(:final threadId) => threadId,
        TurnCompletedEvent(:final threadId) => threadId,
        TurnErrorEvent(:final threadId) => threadId,
        TurnAbortedEvent(:final threadId) => threadId,
        GitProgressEvent(:final threadId) => threadId,
        ModelResolvedEvent(:final threadId) => threadId,
        UnknownDomainEvent() => null,
      };

  Thread _parseThread(Map<String, dynamic> json) {
    // The bridge sends `createdAt` and `updatedAt` (epoch ms). The old parser
    // read `lastActivity`, which the wire never carries — so last-activity was
    // always null. Map `updatedAt` to lastActivity and keep `createdAt` for the
    // default newest-first ordering.
    final createdAt = json['createdAt'];
    final updatedAt = json['updatedAt'] ?? json['lastActivity'];
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
      lastActivity: updatedAt is int
          ? DateTime.fromMillisecondsSinceEpoch(updatedAt)
          : null,
      createdAt: createdAt is int
          ? DateTime.fromMillisecondsSinceEpoch(createdAt)
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
  String thinking = '';

  /// Text runs and structured blocks (commands/diffs/tools) in the exact order
  /// they streamed in, so the rendered turn **interleaves** the work log with
  /// the response instead of grouping all activity above the text.
  final List<MessageContent> segments = [];

  /// Appends a text delta, extending the current trailing text run or starting
  /// a new one (a run is broken whenever a block lands between text).
  void appendText(String delta) {
    if (delta.isEmpty) return;
    final last = segments.isNotEmpty ? segments.last : null;
    if (last is TextContent) {
      segments[segments.length - 1] = TextContent(last.text + delta);
    } else {
      segments.add(TextContent(delta));
    }
  }
}
