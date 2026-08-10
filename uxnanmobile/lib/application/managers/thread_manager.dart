import 'dart:async';
import 'dart:math';

import 'package:rxdart/rxdart.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/core/extensions/string_ext.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/agent_command.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/auth_status.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/domain/enums/assistant_response_phase.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/system_content_kind.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/repositories/i_message_repository.dart';
import 'package:uxnan/domain/repositories/i_thread_repository.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';
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
    Stream<ConnectionPhase>? connectionPhases,
    String? Function()? foregroundThreadId,
    Uuid? uuid,
    Duration resyncTimeout = const Duration(seconds: 8),
    Duration externalSyncInterval = const Duration(seconds: 3),
  })  : _threadRepository = threadRepository,
        _messageRepository = messageRepository,
        _sendRequest = sendRequest,
        _foregroundThreadId = foregroundThreadId,
        _uuid = uuid ?? const Uuid(),
        _resyncTimeout = resyncTimeout,
        _externalSyncInterval = externalSyncInterval {
    _eventsSub = domainEvents.listen(_applyEvent);
    _phaseSub = connectionPhases?.listen(_onConnectionPhase);
  }

  static const int _automaticTitleMaxLength = 72;

  final IThreadRepository _threadRepository;
  final IMessageRepository _messageRepository;
  final RpcSend _sendRequest;

  /// Upper bound on the **resync** `turn/list` round-trip (the newest-page pull
  /// run on resume/reconnect). Tighter than the correlator's 30 s default so a
  /// resync issued over a socket that went half-open while backgrounded fails
  /// fast and "keeps local" — the live re-attach (`activeTurnId` + the
  /// `_ensureLive` self-heal) then restores the in-flight turn from the
  /// stream — instead of hanging the thread view for 30 s (Bug A). Injectable
  /// so tests don't wait it out; older-page paging keeps the default timeout.
  final Duration _resyncTimeout;

  /// Cadence for checking the active native agent session for turns written by
  /// another client (Codex Desktop/CLI, OpenCode Desktop, and supported CLIs).
  /// [Duration.zero] disables the timer in deterministic unit tests.
  final Duration _externalSyncInterval;

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

  /// Threads whose in-flight state we have actually confirmed with the bridge
  /// since the current connection was established.
  ///
  /// Until a thread is in here we do not know whether a turn is running: the
  /// live state lives in the bridge process and reaches us only via
  /// `turn/list`. Reopening the app with a turn still running leaves a window
  /// where the thread looks idle, and a client that trusts that window tells
  /// the user "Send" for a message the bridge is about to queue. Callers treat
  /// absence as "possibly busy" — see [isTurnStateKnown].
  final BehaviorSubject<Set<String>> _turnStateKnown =
      BehaviorSubject.seeded(const {});

  /// Per-thread message queue as the BRIDGE reports it — the follow-ups sent
  /// while a turn was in flight. Mirrored, never owned: the bridge drains the
  /// queue whether or not this app is running, so this map is refreshed from
  /// `stream/queue/updated` and re-read on every `turn/list` resync. Threads
  /// with nothing queued are absent.
  final BehaviorSubject<Map<String, ThreadQueueState>> _queues =
      BehaviorSubject.seeded(const {});

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
  StreamSubscription<ConnectionPhase>? _phaseSub;
  Timer? _externalSyncTimer;
  bool _disposed = false;

  /// Newest-page reads already in flight, keyed by thread.
  final Map<String, Future<void>> _resyncOperations = {};

  /// At most one coalesced follow-up read per thread. An explicit refresh that
  /// arrives during the navigation read must observe state newer than that
  /// first snapshot; repeated reconnect/resume requests share this Future.
  final Map<String, Future<void>> _queuedResyncOperations = {};

  /// Last observed connection phase, to detect transitions INTO connected.
  ConnectionPhase? _lastPhase;

  /// Re-syncs the active thread every time the channel (re)connects. The
  /// bridge's catch-up replay is a bounded in-memory window (it evicts old
  /// frames), so a long disconnection mid-turn can NOT be recovered from the
  /// stream alone — only a `turn/list` re-pull restores the output produced
  /// while the phone was away. This also covers the reconnect paths that don't
  /// go through an app-lifecycle resume (a network blip with the screen on)
  /// and retries a cold-start resync that timed out while the channel was
  /// still coming up.
  void _onConnectionPhase(ConnectionPhase phase) {
    if (_disposed) return;
    final was = _lastPhase;
    _lastPhase = phase;
    if (phase == ConnectionPhase.connected) {
      _ensureExternalSyncTimer();
    } else {
      _externalSyncTimer?.cancel();
      _externalSyncTimer = null;
    }
    if (phase == ConnectionPhase.connected &&
        was != ConnectionPhase.connected) {
      // A new connection can be a different bridge process, or the same one
      // after minutes away: whatever we knew about which turns were running is
      // no longer confirmed until this connection tells us again.
      if (_turnStateKnown.value.isNotEmpty) _turnStateKnown.add(const {});
      unawaited(resyncActive());
    }
  }

  void _ensureExternalSyncTimer() {
    if (_disposed ||
        _externalSyncTimer != null ||
        _externalSyncInterval.inMilliseconds <= 0) {
      return;
    }
    _externalSyncTimer = Timer.periodic(
      _externalSyncInterval,
      (_) => _pollExternalHistory(),
    );
  }

  void _pollExternalHistory() {
    final threadId = _activeThreadId;
    if (_disposed ||
        _lastPhase != ConnectionPhase.connected ||
        threadId == null ||
        _live.containsKey(threadId) ||
        _resyncOperations.containsKey(threadId) ||
        _queuedResyncOperations.containsKey(threadId)) {
      return;
    }
    unawaited(_resyncThread(threadId));
  }

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

  /// Map of threadId → its live [ThreadQueueState]. Threads with an empty,
  /// un-paused queue are omitted from the map.
  Stream<Map<String, ThreadQueueState>> get queuesStream => _queues.stream;

  /// Thread ids whose in-flight state has been confirmed on this connection.
  Stream<Set<String>> get turnStateKnownStream => _turnStateKnown.stream;

  /// Whether we have confirmed with the bridge whether [threadId] has a turn
  /// running. False right after opening the app (or reconnecting) until the
  /// first `turn/list` lands — treat it as "possibly busy", never as idle.
  bool isTurnStateKnown(String threadId) =>
      _turnStateKnown.value.contains(threadId);

  /// The current queue state for [threadId] (empty when nothing is waiting).
  ThreadQueueState queueOf(String threadId) =>
      _queues.value[threadId] ?? ThreadQueueState.empty;

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
    ].where((agent) => !agent.deprecated).toList();
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
    await _syncThreadTitle(threadId, trimmed);
  }

  /// Pushes a title to the bridge.
  ///
  /// [automatic] marks the throwaway name derived from the opening message.
  /// The bridge reads a plain `thread/rename` as **the user renaming by hand**
  /// — final, never replaced — so without this flag our own placeholder would
  /// masquerade as a deliberate choice and block the real generated title from
  /// ever landing.
  Future<void> _syncThreadTitle(
    String threadId,
    String title, {
    bool automatic = false,
  }) async {
    try {
      await _sendRequest('thread/rename', {
        'threadId': threadId,
        'title': title,
        if (automatic) 'source': 'prompt',
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

  /// Loads the special ("slash") commands the bridge reports for [agentId]
  /// (`agent/commands`). [cwd] scopes discovery so a project's own custom
  /// commands are included. Tolerant: an older bridge that lacks the method
  /// simply yields an empty list (the palette then shows only client rows).
  Future<List<AgentCommand>> loadCommands(String agentId, {String? cwd}) async {
    final response = await _sendRequest('agent/commands', {
      'agentId': agentId,
      if (cwd != null && cwd.isNotEmpty) 'cwd': cwd,
    });
    final result = response.result;
    final commands = result is Map ? result['commands'] : null;
    if (commands is! List) return const [];
    return [
      for (final raw in commands)
        if (AgentCommand.fromAny(raw) case final command?) command,
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
    // Keep the bridge title. If it is still a placeholder, the first user
    // prompt becomes a concise conversation title in [sendUserMessage].
    var thread = deviceId != null ? base.copyWith(deviceId: deviceId) : base;
    // The bridge doesn't track the worktree, so persist the path the app
    // created it at — this surfaces the "Remove worktree" action.
    if (worktreePath != null && worktreePath.isNotEmpty) {
      thread = thread.copyWith(worktreePath: worktreePath);
    }
    await _threadRepository.saveThread(thread);
    // Persist the default access mode (full access) on the bridge at creation
    // so the first turn runs without per-tool prompts — deterministic, with no
    // race against the turn that would otherwise inherit the bridge's
    // interactive default. Best-effort: a failure just falls back to seeding on
    // open. The user can still change it per-thread from the composer.
    unawaited(setAccessMode(thread.id, kDefaultApprovalMode));
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

  /// Re-pulls the active thread's newest turns from the bridge — call when the
  /// app resumes / reconnects so a turn that completed while the app was
  /// backgrounded (or the connection had dropped) is recovered without leaving
  /// and re-entering the conversation. No-op when no thread is active; the
  /// request buffers and flushes if the connection is still coming back.
  Future<void> resyncActive() async {
    final threadId = _activeThreadId;
    if (threadId == null) return;
    await _resyncThread(threadId);
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
  /// with `fromEnd`) and persists user + assistant messages not already stored,
  /// keyed by deterministic turn-derived ids. Opening a long thread no
  /// longer re-pulls the whole history — older pages load on demand via
  /// [loadMoreHistory]. A locally-authored user message is matched by turn id;
  /// a native-only user message (written from another app) is inserted beside
  /// its answer.
  Future<void> _resyncThread(String threadId) {
    if (_disposed) return Future<void>.value();
    final queued = _queuedResyncOperations[threadId];
    if (queued != null) return queued;
    final existing = _resyncOperations[threadId];
    if (existing != null) {
      late final Future<void> followUp;
      followUp =
          existing.then((_) => _startResyncThread(threadId)).whenComplete(
        () {
          if (identical(_queuedResyncOperations[threadId], followUp)) {
            _queuedResyncOperations.remove(threadId);
          }
        },
      );
      _queuedResyncOperations[threadId] = followUp;
      return followUp;
    }
    return _startResyncThread(threadId);
  }

  Future<void> _startResyncThread(String threadId) {
    if (_disposed) return Future<void>.value();
    late final Future<void> operation;
    operation = _performResyncThread(threadId).whenComplete(() {
      if (identical(_resyncOperations[threadId], operation)) {
        _resyncOperations.remove(threadId);
      }
    });
    _resyncOperations[threadId] = operation;
    return operation;
  }

  Future<void> _performResyncThread(String threadId) async {
    final page = await _fetchTurns(
      threadId,
      limit: _turnPageSize,
      fromEnd: true,
      timeout: _resyncTimeout,
    );
    if (page == null) return;
    // Re-attach to a turn still in flight on the bridge BEFORE persisting, so a
    // turn we stopped tracking (reconnected/reopened mid-turn) keeps its live
    // view — the indicator + Stop reappear and `_persistTurns` treats it as
    // live (it skips the tracked turn) instead of writing it as a finished
    // message. `activeTurnId` is the bridge's authoritative in-flight state
    // (absent after a bridge restart), so it never resurrects an ended turn.
    final activeTurnId = page.activeTurnId;
    if (activeTurnId != null) {
      // Rebuild the live buffer from the bridge's accumulated record for this
      // in-flight turn (it persists every delta/block BEFORE notifying — see
      // AgentManager.#onEvent — so the snapshot is a superset of everything
      // already streamed to this phone). Replacing UNCONDITIONALLY — even when
      // we already track this turnId — is the fix for the reopen race: after a
      // kill+reopen the first post-reconnect deltas re-create the buffer with
      // only the new tail, and the old `turnId != activeTurnId` guard then
      // skipped the seed, silently dropping everything the agent produced
      // while the app was closed (the bridge's catch-up replay is a bounded
      // window and cannot cover a long absence). Deltas that arrive after this
      // snapshot append cleanly to its trailing run; `_finishTurn` +
      // `_reconcileTurn` converge the final message to the bridge's exact
      // record either way. The only case that keeps the current buffer is a
      // snapshot page that doesn't contain the active turn at all (nothing to
      // seed from).
      final seeded = _seedLiveTurn(activeTurnId, page.turns);
      final current = _live[threadId];
      final tracking = current != null && current.turnId == activeTurnId;
      if (!tracking ||
          seeded.segments.isNotEmpty ||
          seeded.thinking.isNotEmpty) {
        _live[threadId] = seeded;
      }
      _setActivity(threadId, ThreadActivity.running);
    }
    // Re-attach to the message queue the same way. It is live bridge state, so
    // this is what restores the waiting bubbles (and the paused banner) after
    // the app was closed — and what settles a message whose fate we missed
    // while away: it either still waits, or it ran, or it was cancelled.
    _setQueue(threadId, page.queue);
    // The bridge has now told us whether this thread has a turn running, so
    // the UI can stop hedging.
    if (!_turnStateKnown.value.contains(threadId)) {
      _turnStateKnown.add({..._turnStateKnown.value, threadId});
    }
    await _reconcileQueuedMessages(threadId, page.queue.turnIds, page.turns);
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

  /// Builds a [_LiveTurn] for [turnId] pre-filled with the partial assistant
  /// content the bridge already streamed for it, recovered from the `turn/list`
  /// [turns] page. Prefers the bridge's ordered `segments` (text runs + blocks
  /// already interleaved in production order) so the re-attached bubble keeps
  /// the work log inline with the response; falls back to the blocks-first
  /// layout (any blocks, then the accumulated text run **last**) for an older
  /// bridge that doesn't send `segments`. Either way the trailing run lets the
  /// next streamed delta extend in place via [_LiveTurn.appendText] (a delta
  /// after a block opens a fresh run, preserving order). Returns an empty
  /// buffer when the active turn isn't found in the page (the turn carries
  /// no assistant output yet).
  _LiveTurn _seedLiveTurn(String turnId, List<Object?> turns) {
    final live = _LiveTurn(turnId: turnId);
    for (final rawTurn in turns) {
      if (rawTurn is! Map || rawTurn['id'] != turnId) continue;
      final messages = rawTurn['messages'];
      if (messages is! List) continue;
      for (final rawMsg in messages) {
        if (rawMsg is! Map || rawMsg['role'] != 'assistant') continue;
        final thinking = rawMsg['thinking'];
        if (thinking is String && thinking.isNotEmpty) {
          live.thinking += thinking;
        }
        final segments = _decodeBlocks(rawMsg['segments']);
        if (segments.isNotEmpty) {
          live.segments.addAll(segments);
          continue;
        }
        live.segments.addAll(_decodeBlocks(rawMsg['blocks']));
        final content = rawMsg['content'];
        if (content is String && content.isNotEmpty) {
          live.segments.add(TextContent(content));
        }
      }
    }
    return live;
  }

  /// Sends `turn/list` for one page and returns its turns + reported `total`
  /// (null on failure or an older bridge). [fromEnd] asks for the newest page;
  /// otherwise [cursor] is an explicit offset.
  Future<
      ({
        List<Object?> turns,
        int? total,
        String? activeTurnId,
        ThreadQueueState queue,
      })?> _fetchTurns(
    String threadId, {
    String? cursor,
    int? limit,
    bool fromEnd = false,
    Duration? timeout,
  }) async {
    final params = <String, dynamic>{'threadId': threadId};
    if (cursor != null) params['cursor'] = cursor;
    if (limit != null) params['limit'] = limit;
    if (fromEnd) params['fromEnd'] = true;
    final RpcMessage response;
    try {
      final pending = _sendRequest('turn/list', params);
      response = await (timeout == null ? pending : pending.timeout(timeout));
    } on Object catch (error, stackTrace) {
      AppLogger.warn('turn/list resync failed (kept local)', error, stackTrace);
      return null;
    }
    final result = response.result;
    if (result is! Map) return null;
    final turns = result['turns'];
    if (turns is! List) return null;
    final total = result['total'];
    final activeTurnId = result['activeTurnId'];
    final paused = result['queuePaused'] == true;
    return (
      turns: turns,
      total: total is int ? total : null,
      activeTurnId: activeTurnId is String ? activeTurnId : null,
      // Absent on an older bridge → an empty, un-paused queue, which is exactly
      // how a bridge without the feature behaves.
      queue: ThreadQueueState(
        turnIds: _stringList(result['queuedTurnIds']),
        paused: paused,
        pausedReason: paused
            ? QueuePausedReason.fromWire(result['queuePausedReason'])
            : null,
      ),
    );
  }

  /// Settles every locally-`queued` message of [threadId] against the bridge's
  /// authoritative view after a resync.
  ///
  /// A message we left waiting can have three fates while the app was away: it
  /// is still queued, it ran, or it was cancelled. Without this the bubble
  /// would stay a ghost forever — the queue notification that resolved it
  /// arrived while nothing was listening.
  Future<void> _reconcileQueuedMessages(
    String threadId,
    List<String> queuedTurnIds,
    List<Object?> turns,
  ) async {
    final messages = await _messageRepository.getMessages(threadId);
    final stillQueued = queuedTurnIds.toSet();
    final statusByTurn = <String, String>{
      for (final turn in turns)
        if (turn is Map && turn['id'] is String && turn['status'] is String)
          turn['id'] as String: turn['status'] as String,
    };
    for (final message in messages) {
      if (message.deliveryState != MessageDeliveryState.queued) continue;
      if (message.turnId.isEmpty || stillQueued.contains(message.turnId)) {
        continue;
      }
      // Off the queue. `cancelled` is the only status that means "never ran";
      // anything else (streaming/completed/error/aborted) means it did, so the
      // bubble becomes an ordinary sent message. A turn missing from this page
      // is also treated as sent — it is old enough to have scrolled out of it.
      final ran = statusByTurn[message.turnId] != 'cancelled';
      await _messageRepository.saveMessage(
        message.copyWith(
          deliveryState:
              ran ? MessageDeliveryState.sent : MessageDeliveryState.cancelled,
        ),
      );
    }
  }

  /// Persists the user prompts and assistant answers from a fetched page of
  /// [turns]. Mobile-authored users reconcile by turn id; native-only users and
  /// assistant answers use deterministic ids. When [trackLatestUsage] is true,
  /// the last turn's token usage restores the context meter (only meaningful
  /// for the newest page).
  Future<void> _persistTurns(
    String threadId,
    List<Object?> turns, {
    required bool trackLatestUsage,
    bool olderPage = false,
  }) async {
    final existing = await _messageRepository.getMessages(threadId);
    final byId = {for (final m in existing) m.id: m};
    final userByTurn = <String, Message>{
      for (final message in existing)
        if (message.role == MessageRole.user && message.turnId.isNotEmpty)
          message.turnId: message,
    };
    final toSave = <Message>[];
    // New (not-yet-stored) messages collected in document order
    // (oldest→newest);
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
        if (rawMsg is! Map) continue;
        final role = rawMsg['role'];
        final content = rawMsg['content'];
        if (content is! String || content.isEmpty) continue;
        if (role == 'user') {
          // Mobile-authored messages already carry the bridge turn id after
          // `turn/send`, so matching by (turn, role) preserves their UUID,
          // attachments, and delivery state. A missing user is genuinely from
          // another client and gets a deterministic local id.
          if (userByTurn.containsKey(turnId)) continue;
          final message = Message(
            id: _streamUserId(turnId),
            threadId: threadId,
            turnId: turnId,
            role: MessageRole.user,
            contents: [TextContent(content)],
            deliveryState: rawTurn['status'] == 'cancelled'
                ? MessageDeliveryState.cancelled
                : MessageDeliveryState.sent,
            orderIndex: 0,
            createdAt: _millisToDate(rawMsg['createdAt']),
          );
          pending.add(message);
          userByTurn[turnId] = message;
          continue;
        }
        if (role != 'assistant') continue;
        final thinking =
            rawMsg['thinking'] is String ? rawMsg['thinking'] as String : '';
        final blocks = _decodeBlocks(rawMsg['blocks']);
        // `segments` carries the assistant's text runs and blocks already
        // interleaved in production order (bridge thread-store). When present
        // we render from it so the work log sits inline with the response;
        // absent (older bridge / native-history record without order) we fall
        // back to the blocks-first layout. Its text runs concatenate to
        // `content` and its
        // non-text entries are exactly `blocks` — see the reconciliation below.
        final segments = _decodeBlocks(rawMsg['segments']);
        final usage = _parseUsage(rawMsg['usage']);
        if (usage != null) latestUsage = usage;
        // Don't clobber a turn that is still streaming live on this device.
        if (_live[threadId]?.turnId == turnId) continue;
        final id = _streamId(turnId);
        final contents = segments.isNotEmpty
            ? _assistantContentsOrdered(thinking, segments, streaming: false)
            : _assistantContents(content, thinking, blocks, streaming: false);
        final present = byId[id];
        if (present != null) {
          // Decide whether the stored copy needs rewriting. With `segments` we
          // know the exact ordered shape, so compare the freshly-built contents
          // against the stored ones by their ordered (type, text) signature —
          // this also repairs a turn persisted blocks-first by an older client
          // (same text + block count, but the wrong order). Without `segments`
          // we keep the cheaper text + thinking + block-count check (a turn
          // whose reasoning/blocks arrived only via history still reconciles).
          final bool changed;
          if (segments.isNotEmpty) {
            changed = !_sameContentOrder(present.contents, contents);
          } else {
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
            changed = presentText != content ||
                presentThinking != thinking ||
                presentBlocks != blocks.length;
          }
          if (changed) {
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
    ({String name, String? args})? command,
  }) async {
    final images = attachments ?? const <ImageContent>[];
    final contents = <MessageContent>[
      if (text.isNotEmpty) TextContent(text),
      ...images,
    ];
    if (contents.isEmpty) return;
    await _titleFromFirstPrompt(threadId, text);
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
    // Bridge contract (TurnSendParams): { threadId, text?, attachments?,
    // options?, command? }. Text lives at the top level; nesting it under
    // `content` makes the bridge reject the turn. `options` carries the chosen
    // per-model run-option knobs.
    // Surface failures: if the bridge rejects the turn (e.g. `thread not
    // found`), mark the user's message FAILED instead of swallowing it.
    //
    try {
      final res = await _sendRequest('turn/send', {
        'threadId': threadId,
        // A command invocation carries no free-form text: the bridge resolves
        // `{ name, args }` to the prompt the agent runs (expanded custom
        // template or the CLI's native `/name args` form).
        if (command == null) 'text': text,
        if (command != null)
          'command': {
            'name': command.name,
            if (command.args != null && command.args!.isNotEmpty)
              'args': command.args,
          },
        if (options != null && options.isNotEmpty) 'options': options,
        if (images.isNotEmpty)
          'attachments': [for (final image in images) image.toJson()],
      });
      if (res.error != null) {
        await _messageRepository.saveMessage(
          message.copyWith(deliveryState: MessageDeliveryState.failed),
        );
        AppLogger.warn('turn/send rejected: ${res.error!.message}');
        return;
      }
      // The bridge queues a message sent while a turn is in flight and answers
      // `{ turnId, queued: true }`. Record BOTH: the turn id is what lets the
      // user take this message back (`turn/cancel`), and the queued state is
      // what renders it as a waiting "ghost" bubble instead of a sent one.
      final result = res.result;
      final resultTurnId = result is Map ? result['turnId'] : null;
      final queued = result is Map && result['queued'] == true;
      await _messageRepository.saveMessage(
        message.copyWith(
          turnId: resultTurnId is String ? resultTurnId : null,
          deliveryState:
              queued ? MessageDeliveryState.queued : MessageDeliveryState.sent,
        ),
      );
    } on Object catch (error, stackTrace) {
      await _messageRepository.saveMessage(
        message.copyWith(deliveryState: MessageDeliveryState.failed),
      );
      AppLogger.warn('turn/send failed', error, stackTrace);
    }
  }

  /// Takes a queued message off the queue and **removes it from the timeline**,
  /// leaving no trace — the message is going back to the composer to be
  /// rewritten, so a "cancelled" husk beside the text being re-edited would be
  /// noise, not a record.
  ///
  /// The bridge still marks the turn `cancelled` (its history stays honest);
  /// this only drops the phone's local echo of the user's message. Returns
  /// whether the bridge accepted the cancel — the text goes back only if the
  /// message really left the queue, or it would run AND sit in the composer.
  Future<bool> withdrawQueuedTurn(String threadId, String turnId) async {
    if (!await cancelQueuedTurn(threadId, turnId)) return false;
    await _serializeWrite(() async {
      final messages = await _messageRepository.getMessages(threadId);
      for (final message in messages) {
        if (message.turnId == turnId && message.role == MessageRole.user) {
          await _messageRepository.deleteMessage(message.id);
          return;
        }
      }
    });
    return true;
  }

  /// Takes a queued message back before the agent ever sees it
  /// (`turn/cancel` on a `queued` turn). The bridge marks the turn `cancelled`
  /// and echoes `stream/turn/cancelled`, which is what flips the local bubble —
  /// so the message stays in the timeline, marked, rather than vanishing.
  ///
  /// Returns whether the bridge accepted it.
  Future<bool> cancelQueuedTurn(String threadId, String turnId) async {
    try {
      final res = await _sendRequest('turn/cancel', {
        'threadId': threadId,
        'turnId': turnId,
      });
      if (res.error != null) {
        AppLogger.warn('turn/cancel (queued) rejected: ${res.error!.message}');
        return false;
      }
      return true;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('turn/cancel (queued) failed', error, stackTrace);
      return false;
    }
  }

  /// Resumes a queue the bridge held after the user stopped a turn (or one
  /// failed). The bridge starts the next queued turn immediately.
  Future<void> resumeQueue(String threadId) async {
    await _queueControl(threadId, 'queue/resume');
  }

  /// Drops every queued message for [threadId]; each is marked cancelled and
  /// stays in the timeline.
  Future<void> clearQueue(String threadId) async {
    await _queueControl(threadId, 'queue/clear');
  }

  /// Sends a `queue/*` control call and applies the state it returns, so the UI
  /// settles even if the broadcast notification is slow or lost.
  Future<void> _queueControl(String threadId, String method) async {
    try {
      final res = await _sendRequest(method, {'threadId': threadId});
      if (res.error != null) {
        AppLogger.warn('$method rejected: ${res.error!.message}');
        return;
      }
      final result = res.result;
      if (result is! Map) return;
      _setQueue(
        threadId,
        ThreadQueueState(
          turnIds: _stringList(result['queuedTurnIds']),
          paused: result['paused'] == true,
          pausedReason: result['paused'] == true
              ? QueuePausedReason.fromWire(result['pausedReason'])
              : null,
        ),
      );
    } on Object catch (error, stackTrace) {
      AppLogger.warn('$method failed', error, stackTrace);
    }
  }

  /// Stores [state] for [threadId], dropping the entry entirely when the thread
  /// is back to "nothing queued, nothing held" so listeners can treat a missing
  /// key as idle.
  void _setQueue(String threadId, ThreadQueueState state) {
    final current = _queues.value[threadId] ?? ThreadQueueState.empty;
    if (current == state) return;
    final next = Map<String, ThreadQueueState>.from(_queues.value);
    if (state.turnIds.isEmpty && !state.paused) {
      next.remove(threadId);
    } else {
      next[threadId] = state;
    }
    _queues.add(next);
  }

  /// Drops [turnId] from the thread's mirrored queue.
  ///
  /// A hand-off into the running turn changes no queue on the bridge (the turn
  /// was never parked there), so no `stream/queue/updated` follows to settle
  /// it. A client that HAD it listed — restored from a snapshot taken before
  /// the hand-off — would otherwise keep drawing a dashed bubble for a message
  /// the agent already has.
  void _removeFromQueue(String threadId, String turnId) {
    final current = _queues.value[threadId];
    if (current == null || !current.turnIds.contains(turnId)) return;
    _setQueue(
      threadId,
      ThreadQueueState(
        turnIds: [
          for (final id in current.turnIds)
            if (id != turnId) id,
        ],
        paused: current.paused,
        pausedReason: current.pausedReason,
      ),
    );
  }

  static List<String> _stringList(Object? value) {
    if (value is! List) return const [];
    return [
      for (final entry in value)
        if (entry is String) entry,
    ];
  }

  /// Serializes the delivery-state writes that queue events trigger.
  ///
  /// `stream/turn/cancelled` and `stream/queue/updated` arrive back to back for
  /// the same message and both rewrite its state — read-modify-write, so
  /// running them concurrently lets the loser overwrite the winner and a
  /// cancelled message comes back as merely "sent". Events are applied in
  /// order, so chaining their writes makes the outcome deterministic: last
  /// event wins, always.
  Future<void> _messageWrites = Future<void>.value();

  Future<void> _serializeWrite(Future<void> Function() write) {
    final next = _messageWrites.then((_) => write()).catchError((
      Object error,
      StackTrace stackTrace,
    ) {
      AppLogger.warn('queued-message write failed', error, stackTrace);
    });
    _messageWrites = next;
    return next;
  }

  /// Clears the local `queued` echo of any message the bridge no longer lists
  /// as waiting — it either started or was cancelled, and either way it is no
  /// longer a ghost. A cancelled one is already settled by
  /// `stream/turn/cancelled` (which lands first and is skipped here, since only
  /// a still-`queued` message is touched); anything else that left the queue
  /// ran.
  Future<void> _settleLocalQueueEchoes(
    String threadId,
    List<String> stillQueued,
  ) {
    final waiting = stillQueued.toSet();
    return _serializeWrite(() async {
      final messages = await _messageRepository.getMessages(threadId);
      var end = _maxOrder(messages);
      for (final message in messages) {
        if (message.deliveryState != MessageDeliveryState.queued) continue;
        if (message.turnId.isEmpty || waiting.contains(message.turnId)) {
          continue;
        }
        // Anything cancelled is already `cancelled` by the time this runs
        // (`stream/turn/cancelled` lands first and writes are serialized), so a
        // message still `queued` that left the queue is one that STARTED — and
        // it belongs at the end, where it was delivered, not back above the
        // previous turn's reply where it was typed.
        await _messageRepository.saveMessage(
          message.copyWith(
            deliveryState: MessageDeliveryState.sent,
            orderIndex: ++end,
          ),
        );
      }
    });
  }

  /// Flips the local user message belonging to [turnId] to [state] (used when a
  /// queued message is cancelled, or starts running). No-op when the thread has
  /// no such message — e.g. it was queued from another device.
  Future<void> _markUserMessage(
    String threadId,
    String turnId,
    MessageDeliveryState state, {
    bool reorderToEnd = false,
  }) {
    if (turnId.isEmpty) return Future<void>.value();
    return _serializeWrite(() async {
      final messages = await _messageRepository.getMessages(threadId);
      for (final message in messages) {
        if (message.turnId != turnId || message.role != MessageRole.user) {
          continue;
        }
        if (message.deliveryState == state && !reorderToEnd) return;
        // A message that waited in the queue belongs where it was DELIVERED,
        // not where it was typed: it was stored while the previous turn was
        // still running, so its original index would file it above that turn's
        // reply — as if the user had said it before getting an answer.
        final movedToEnd = reorderToEnd &&
            message.deliveryState == MessageDeliveryState.queued;
        await _messageRepository.saveMessage(
          message.copyWith(
            deliveryState: state,
            orderIndex: movedToEnd ? _maxOrder(messages) + 1 : null,
          ),
        );
        return;
      }
    });
  }

  /// Applies a title the BRIDGE decided on.
  ///
  /// Skips a `prompt`-sourced one: that is the same provisional name this app
  /// already wrote locally, so re-applying it only churns the row. A `user`
  /// title comes from another device and is authoritative.
  Future<void> _adoptBridgeTitle(
    String threadId,
    String title,
    String titleSource,
  ) async {
    final trimmed = title.trim();
    if (trimmed.isEmpty || titleSource == 'prompt') return;
    final thread = await _threadRepository.getThread(threadId);
    if (thread == null || thread.title == trimmed) return;
    await _threadRepository.saveThread(thread.copyWith(title: trimmed));
  }

  /// Settles a message the agent took **into the turn already running**: it
  /// becomes an ordinary sent message, in the place it was already showing.
  ///
  /// `reorderToEnd` only bites on a message that was still locally `queued`
  /// (a second device, or a reconnect that restored it from a pre-hand-off
  /// snapshot): a queued bubble sits below the timeline, so settling it at the
  /// end is what keeps it exactly where the user last saw it, instead of
  /// filing it back above the reply that was streaming when they wrote it.
  Future<void> _settleDeliveredMessage(String threadId, String turnId) {
    _removeFromQueue(threadId, turnId);
    return _markUserMessage(
      threadId,
      turnId,
      MessageDeliveryState.sent,
      reorderToEnd: true,
    );
  }

  Future<void> _titleFromFirstPrompt(String threadId, String text) async {
    final normalized = text.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (normalized.isEmpty) return;

    final thread = await _threadRepository.getThread(threadId);
    if (thread == null || !_hasPlaceholderTitle(thread)) return;

    final messages = await _messageRepository.getMessages(threadId);
    if (messages.any((message) => message.role == MessageRole.user)) return;

    final title = normalized.truncate(_automaticTitleMaxLength);
    await _threadRepository.saveThread(thread.copyWith(title: title));
    unawaited(_syncThreadTitle(threadId, title, automatic: true));
  }

  static bool _hasPlaceholderTitle(Thread thread) {
    final title = thread.title.trim();
    return title.isEmpty ||
        title == thread.id ||
        title == 'New' ||
        title == 'New thread';
  }

  /// Responds to a pending approval ([approvalId]) on [threadId] with
  /// [decision], via `turn/send { approvalResponse }`. Returns true when the
  /// bridge accepts it. No local message is created — the response is control
  /// data, not chat. The bridge routes the decision back to approval-capable
  /// agents such as Claude, Codex and OpenCode.
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

  /// Answers a pending question set ([questionId]) on [threadId] with
  /// [answers], via `turn/send { questionResponse }`. [answers] is one entry
  /// per question, each a list of chosen option labels (a single value for
  /// single-select, several for a `multiple` question, an empty list to skip
  /// that question). Returns true when the bridge accepts it. No local message
  /// is created — the response is control data, not chat.
  Future<bool> respondQuestion({
    required String threadId,
    required String questionId,
    required List<List<String>> answers,
  }) async {
    try {
      final res = await _sendRequest('turn/send', {
        'threadId': threadId,
        'questionResponse': {
          'questionId': questionId,
          'answers': answers,
        },
      });
      if (res.error != null) {
        AppLogger.warn('question response rejected: ${res.error!.message}');
        return false;
      }
      return true;
    } on Object catch (error, stackTrace) {
      AppLogger.warn('question response failed', error, stackTrace);
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
    if (_disposed) return;
    _disposed = true;
    _externalSyncTimer?.cancel();
    _externalSyncTimer = null;
    _streamRebuildTimer?.cancel();
    _streamRebuildTimer = null;
    await _eventsSub.cancel();
    await _messagesSub?.cancel();
    await _phaseSub?.cancel();
    await Future.wait([
      ..._resyncOperations.values,
      ..._queuedResyncOperations.values,
    ]);
    await _timeline.close();
    await _resolvedModels.close();
    await _activity.close();
    await _unread.close();
    await _queues.close();
    await _turnStateKnown.close();
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
        // Never wipe a buffer we already hold for this same turn: the bridge
        // emits `turn/started` once per turn, so a second one can only be the
        // reconnect catch-up replay re-delivering it — after the re-sync may
        // have just seeded the buffer with the turn's accumulated output.
        if (_live[threadId]?.turnId != turnId) {
          _live[threadId] = _LiveTurn(turnId: turnId);
        }
        _setActivity(threadId, ThreadActivity.running);
        // A turn the queue just drained to: its bubble stops being a ghost,
        // becomes an ordinary sent message, and takes its place at the end of
        // the conversation — where it was actually delivered.
        unawaited(
          _markUserMessage(
            threadId,
            turnId,
            MessageDeliveryState.sent,
            reorderToEnd: true,
          ),
        );
        if (threadId == _activeThreadId) _rebuildActiveTimeline();
      case MessageDeltaEvent(:final turnId, :final delta):
        final live = _ensureLive(threadId, turnId)..appendText(delta);
        if (threadId == _activeThreadId) {
          _rebuildActiveTimelineCoalesced(live.streamedLength);
        }
      case ThinkingDeltaEvent(:final turnId, :final delta):
        final live = _ensureLive(threadId, turnId)..thinking += delta;
        if (threadId == _activeThreadId) {
          _rebuildActiveTimelineCoalesced(live.streamedLength);
        }
      case ContentBlockEvent(:final turnId, :final content, :final beforeText):
        _ensureLive(threadId, turnId).addBlock(content, beforeText: beforeText);
        if (threadId == _activeThreadId) _rebuildActiveTimeline();
      case TurnCompletedEvent(
          :final turnId,
          :final text,
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
        unawaited(
          // After finalizing from the live buffer, reconcile the persisted
          // message against the bridge's authoritative ordered record — the
          // live view can be imperfect (a delta in transit during a re-sync, a
          // re-attach that missed early blocks); the bridge's is not.
          _finishTurn(threadId, turnId, failed: false, finalText: text)
              .then((_) => _reconcileTurn(threadId, turnId)),
        );
      case TurnErrorEvent(:final turnId, :final message):
        unawaited(
          _finishTurn(threadId, turnId, failed: true, errorText: message),
        );
      case TurnAbortedEvent(:final turnId):
        unawaited(_finishTurn(threadId, turnId, failed: false));
      case TurnCancelledEvent(:final turnId):
        // A queued message taken off the queue — here or from another device.
        // It never ran, so there is no live buffer to finalize: only the user's
        // own bubble changes, keeping the record of what was not sent.
        unawaited(
          _markUserMessage(threadId, turnId, MessageDeliveryState.cancelled),
        );
      case TurnDeliveredEvent(:final turnId):
        // The agent took this message INTO the turn it was already running, so
        // it will never run on its own. It is not cancelled — it was received —
        // so the bubble becomes an ordinary sent message and simply stops
        // offering to edit or cancel. Mirrors what a drained queue does; it
        // just happened without the wait.
        //
        // Usually a no-op on the device that sent it, because `turn/send`
        // already answered `delivered: true`. It matters for the OTHER cases:
        // a second phone watching the thread, and a reconnect that restored
        // this message from a queue snapshot taken before the hand-off.
        unawaited(_settleDeliveredMessage(threadId, turnId));
      case QueueUpdatedEvent(
          :final queuedTurnIds,
          :final paused,
          :final pausedReason,
        ):
        // Whole-state notification: adopt it as-is. Missing one (backgrounded,
        // mid-reconnect) is harmless — the next one converges.
        _setQueue(
          threadId,
          ThreadQueueState(
            turnIds: queuedTurnIds,
            paused: paused,
            pausedReason: paused ? pausedReason : null,
          ),
        );
        // Clear the local "waiting" echo for anything the bridge no longer
        // holds. Without this the flag would depend entirely on catching the
        // turn's `turn_started`, and a missed one would leave the bubble a
        // ghost forever — the bridge's list is the authority, so settle
        // against it every time it changes.
        unawaited(_settleLocalQueueEchoes(threadId, queuedTurnIds));
        if (threadId == _activeThreadId) _rebuildActiveTimeline();
      case ThreadRenamedEvent(:final title, :final titleSource):
        // The bridge named the conversation (usually a model replacing the
        // provisional title taken from the opening message). Adopt it locally
        // so the list converges without a refetch — never over a title the user
        // chose here, which the bridge also refuses to overwrite.
        unawaited(_adoptBridgeTitle(threadId, title, titleSource));
      case GitProgressEvent() || ModelResolvedEvent() || UnknownDomainEvent():
        break;
    }
  }

  /// Returns the live buffer for [threadId], creating (or replacing) it when a
  /// stream event arrives for a turn we are not currently tracking.
  ///
  /// This makes the phone **self-heal**: if it lost the `turn_started` (e.g. it
  /// reconnected mid-turn, or was killed and reopened while the agent kept
  /// running on the PC), any further streamed output re-attaches the live view
  /// and re-lights the "responding…" indicator + Stop button — instead of the
  /// event being silently dropped and the turn looking dead forever. The bridge
  /// serializes one in-flight turn per thread and never streams after a turn
  /// ends, so a delta for a different `turnId` means the tracked one is stale
  /// and is correctly replaced.
  _LiveTurn _ensureLive(String threadId, String turnId) {
    final existing = _live[threadId];
    if (existing != null && existing.turnId == turnId) return existing;
    final live = _LiveTurn(turnId: turnId);
    _live[threadId] = live;
    _setActivity(threadId, ThreadActivity.running);
    return live;
  }

  /// Finalizes a turn for [threadId]: persists the buffered assistant text
  /// (keyed by the deterministic id so it reconciles with a later re-sync),
  /// clears the live buffer and updates the thread's activity.
  Future<void> _finishTurn(
    String threadId,
    String turnId, {
    required bool failed,
    String? finalText,
    String? errorText,
  }) async {
    final live = _live.remove(threadId);
    _setActivity(threadId, failed ? ThreadActivity.error : ThreadActivity.idle);
    if (live == null) return;
    // Reconcile the terminal adapter text with the live buffer without ever
    // deleting prose the user already saw. Most adapters return the complete
    // accumulated answer, but some protocols return only their last native
    // assistant item. In that divergent case keep both, separated by durable
    // response metadata; the immediate `turn/read` below then converges to the
    // bridge's exact record.
    //  - buffer text == finalText → the live interleave is complete; keep it.
    //  - buffer text is a strict PREFIX of finalText → only the tail was
    //    missed; extend the trailing run so the interleave survives intact.
    //  - terminal text is already contained in the buffer → keep the buffer.
    //  - buffer empty → append the terminal text after any received blocks.
    //  - anything else → retain it as another response, never replace.
    final liveText =
        live.segments.whereType<TextContent>().map((t) => t.text).join();
    final List<MessageContent> baseContents;
    if (finalText == null ||
        finalText.isEmpty ||
        liveText == finalText ||
        liveText.contains(finalText)) {
      baseContents = _assistantContentsOrdered(
        live.thinking,
        live.segments,
        streaming: false,
      );
    } else if (liveText.isNotEmpty && finalText.startsWith(liveText)) {
      live.appendText(finalText.substring(liveText.length));
      baseContents = _assistantContentsOrdered(
        live.thinking,
        live.segments,
        streaming: false,
      );
    } else if (liveText.isNotEmpty && finalText.contains(liveText)) {
      final at = finalText.indexOf(liveText);
      live.expandText(
        prefix: finalText.substring(0, at),
        suffix: finalText.substring(at + liveText.length),
      );
      baseContents = _assistantContentsOrdered(
        live.thinking,
        live.segments,
        streaming: false,
      );
    } else if (liveText.isEmpty) {
      live.appendText(finalText);
      baseContents = _assistantContentsOrdered(
        live.thinking,
        live.segments,
        streaming: false,
      );
    } else {
      live
        ..addBlock(
          const AssistantResponseBoundaryContent(
            phase: AssistantResponsePhase.finalAnswer,
          ),
        )
        ..appendText(finalText);
      baseContents = _assistantContentsOrdered(
        live.thinking,
        live.segments,
        streaming: false,
      );
    }
    // On a failed turn, surface the bridge's error text as an inline error
    // banner so the user sees *why* the turn ended (e.g. a quota / "usage
    // balance exhausted" error) instead of the "responding…" cue just
    // vanishing. Empty text falls back to a localized label at render time
    // (see `_SystemBanner`).
    final contents = failed
        ? [
            ...baseContents,
            SystemContent(
              (errorText ?? '').trim(),
              kind: SystemContentKind.error,
            ),
          ]
        : baseContents;
    final finalized = Message(
      id: _streamId(turnId),
      threadId: threadId,
      turnId: turnId,
      role: MessageRole.assistant,
      contents: contents,
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

  /// Re-pulls one just-completed turn (`turn/read`) and reconciles the locally
  /// persisted assistant message against the bridge's authoritative record —
  /// the bridge persists every delta/block in production order BEFORE
  /// notifying, so its `segments` are exact even when the phone's live view
  /// was not (output streamed while the app was closed, a delta in transit
  /// during a re-sync). Runs through [_persistTurns], which rewrites the
  /// stored message only when content or order actually differs. Best-effort:
  /// a failure (older bridge, transient drop) keeps the local copy — the next
  /// thread re-sync repairs it the same way.
  Future<void> _reconcileTurn(String threadId, String turnId) async {
    try {
      final response = await _sendRequest('turn/read', {'turnId': turnId})
          .timeout(_resyncTimeout);
      final turn = response.result;
      if (turn is! Map) return;
      await _persistTurns(threadId, [turn], trackLatestUsage: false);
      if (threadId == _activeThreadId) _rebuildActiveTimeline();
    } on Object catch (error, stackTrace) {
      AppLogger.warn(
        'turn/read reconcile failed (kept local)',
        error,
        stackTrace,
      );
    }
  }

  /// How long a streamed delta may wait before it is on screen, given how much
  /// of the reply is already there.
  ///
  /// The reply is rendered as Markdown while it streams, and every rebuild
  /// re-parses ALL of it — so a turn costs time quadratic in its own length,
  /// which is what made streaming feel slower than the unformatted text the app
  /// used to show. Rebuilding less often is the whole fix, but a fixed window
  /// is the wrong shape for it: agents emit a delta roughly every 20 ms, so a
  /// one-frame window collapses almost nothing, while a window wide enough to
  /// help a long reply would make a short one look chunky for no gain.
  ///
  /// So the window grows with the reply, exactly where the cost is. Measured on
  /// a realistic 6000-character reply (prose, list, inline code, fenced block)
  /// arriving as 1500 deltas: 18.9 s of rebuild work uncoalesced, 16.0 s at one
  /// frame, 6.7 s at 50 ms, 3.4 s at 100 ms.
  ///
  /// Nothing is dropped and nothing waits for the turn to end: whatever lands
  /// inside the window is rendered together on the next frame, still fully
  /// formatted.
  static Duration _streamCoalesceWindow(int length) =>
      Duration(milliseconds: (length ~/ 60).clamp(16, 100));

  Timer? _streamRebuildTimer;

  /// Rebuild for a streamed delta, at most once per frame.
  ///
  /// Only deltas go through here. Every other event (a turn completing, a block
  /// landing, a re-sync) still rebuilds immediately: those are one-off and the
  /// user must see them at once.
  void _rebuildActiveTimelineCoalesced(int streamedLength) {
    if (_streamRebuildTimer?.isActive ?? false) return;
    _streamRebuildTimer = Timer(_streamCoalesceWindow(streamedLength), () {
      if (_disposed) return;
      _rebuildActiveTimeline();
    });
  }

  /// Render anything a coalesced delta left pending, now.
  ///
  /// A turn that ends inside the window would otherwise show its last few
  /// characters a frame late, or — if the timeline stopped changing — not until
  /// something else moved.
  void _flushStreamRebuild() {
    if (!(_streamRebuildTimer?.isActive ?? false)) return;
    _streamRebuildTimer?.cancel();
    _streamRebuildTimer = null;
  }

  /// Rebuilds the active timeline from persisted messages plus any in-flight
  /// streaming overlay from the live buffer.
  void _rebuildActiveTimeline() {
    // An immediate rebuild renders everything, so a delta still waiting out its
    // window would only rebuild the same state again a frame later.
    _flushStreamRebuild();
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

    // A message still WAITING in the queue is not part of the conversation yet:
    // it is pinned below everything, including the reply being streamed right
    // now, for as long as it waits. Separating it here is also what keeps the
    // timeline stable — the streaming message is anchored to
    // `max(orderIndex) + 1`, so leaving a queued message in the same pool made
    // every send push the live reply below it and re-sort the whole view.
    final queuedTurnIds = queueOf(threadId).turnIds.toSet();
    final settled = <Message>[];
    final waiting = <Message>[];
    for (final message in windowed) {
      if (message.turnId.isNotEmpty && queuedTurnIds.contains(message.turnId)) {
        waiting.add(message);
      } else {
        settled.add(message);
      }
    }

    var snapshot = const TurnTimelineSnapshot().reconcile(settled).copyWith(
          hasMore: hasMore,
        );
    var nextOrder = _maxOrder(settled) + 1;
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
        orderIndex: nextOrder,
        createdAt: live.startedAt,
      );
      nextOrder += 1;
      snapshot = snapshot
          .reconcile([streaming]).copyWith(streamingTurnId: live.turnId);
    }
    if (waiting.isNotEmpty) {
      // Keep the queue's own order (the bridge's run order), then lay them out
      // after everything else. Only the render index is rewritten — the stored
      // `orderIndex` is untouched, so a message drops back into its
      // chronological place the moment it leaves the queue.
      waiting.sort((a, b) {
        final byQueue = queueOf(threadId)
            .turnIds
            .indexOf(a.turnId)
            .compareTo(queueOf(threadId).turnIds.indexOf(b.turnId));
        return byQueue != 0 ? byQueue : a.orderIndex.compareTo(b.orderIndex);
      });
      snapshot = snapshot.reconcile([
        for (final message in waiting)
          message.copyWith(orderIndex: nextOrder++),
      ]);
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

  String _streamUserId(String turnId) => 'stream-user-$turnId';

  /// Decodes a wire array of structured MessageContent JSON (the `blocks` array
  /// or the ordered `segments` array, where text runs decode to [TextContent])
  /// from a `turn/list` message into content blocks; tolerant of missing or
  /// malformed entries.
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
  /// This is the **fallback** history layout, used only when the bridge sends
  /// no ordered `segments` (an older bridge, or the on-disk history fallback
  /// in `session-history.ts`): with no interleave position the blocks sit
  /// before the merged text run. When `segments` *are* present the caller uses
  /// [_assistantContentsOrdered] instead, restoring the real text↔work-log
  /// order. AssistantTurnView renders whichever order it is given.
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

  /// Whether two content lists carry the same blocks in the same order, by an
  /// `isStreaming`-agnostic content equality. Used to
  /// decide if a stored assistant message must be rewritten on re-sync — it is
  /// true when only the streaming flag differs (no rewrite) and false when the
  /// order or content changed (e.g. a turn stored blocks-first now arrives
  /// interleaved).
  static bool _sameContentOrder(
    List<MessageContent> a,
    List<MessageContent> b,
  ) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      final left = a[i];
      final right = b[i];
      if (left.type != right.type) return false;
      if (left is TextContent && right is TextContent) {
        if (left.text != right.text) return false;
      } else if (left is ThinkingContent && right is ThinkingContent) {
        if (left.text != right.text) return false;
      } else if (left != right) {
        // Metadata-only blocks (response boundaries and compactions) have an
        // empty plain-text projection, so compare their complete value instead
        // of accidentally treating every instance as identical.
        return false;
      }
    }
    return true;
  }

  /// The `orderIndex` to store a new local message with.
  ///
  /// Derived from the PERSISTED messages, not from the rendered timeline: the
  /// timeline also carries the live streaming message and any queued bubbles
  /// pinned below it, both of which use synthetic render indices. Reading the
  /// last rendered index would fold those synthetic values back into storage
  /// and make the stored order drift upward with every send.
  int _nextOrderIndex() => _maxOrder(_activePersisted) + 1;

  static String? _threadOf(DomainEvent event) => switch (event) {
        TurnStartedEvent(:final threadId) => threadId,
        MessageDeltaEvent(:final threadId) => threadId,
        ThinkingDeltaEvent(:final threadId) => threadId,
        ContentBlockEvent(:final threadId) => threadId,
        TurnCompletedEvent(:final threadId) => threadId,
        TurnErrorEvent(:final threadId) => threadId,
        TurnAbortedEvent(:final threadId) => threadId,
        TurnCancelledEvent(:final threadId) => threadId,
        TurnDeliveredEvent(:final threadId) => threadId,
        QueueUpdatedEvent(:final threadId) => threadId,
        GitProgressEvent(:final threadId) => threadId,
        ModelResolvedEvent(:final threadId) => threadId,
        ThreadRenamedEvent(:final threadId) => threadId,
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

  /// How much prose is on screen for this turn — what a rebuild has to
  /// re-parse, and so what decides how often it is worth rebuilding.
  int get streamedLength {
    var total = thinking.length;
    for (final segment in segments) {
      if (segment is TextContent) total += segment.text.length;
    }
    return total;
  }

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

  /// Adds terminal text that surrounded a partial live buffer (typically after
  /// reconnect) while preserving every structured block's relative position.
  void expandText({required String prefix, required String suffix}) {
    final firstText = segments.indexWhere((content) => content is TextContent);
    final lastText =
        segments.lastIndexWhere((content) => content is TextContent);
    if (firstText < 0 || lastText < 0) {
      appendText(prefix + suffix);
      return;
    }
    final first = segments[firstText] as TextContent;
    segments[firstText] = TextContent(prefix + first.text);
    final last = segments[lastText] as TextContent;
    segments[lastText] = TextContent(last.text + suffix);
  }

  /// Adds a structured block. When [beforeText] is set (the block came from a
  /// parallel/background activity while the main text was still streaming —
  /// see `ContentBlockEvent.beforeText`) it is inserted BEFORE the trailing
  /// open text run, so the run is never severed and the next delta keeps
  /// extending it in place; otherwise it appends in arrival order.
  void addBlock(MessageContent content, {bool beforeText = false}) {
    final last = segments.isNotEmpty ? segments.last : null;
    if (beforeText && last is TextContent) {
      segments.insert(segments.length - 1, content);
    } else {
      segments.add(content);
    }
  }
}
