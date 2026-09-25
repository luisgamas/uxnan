import 'dart:async';

import 'package:rxdart/rxdart.dart';
import 'package:uxnan/application/managers/thread_action_outbox.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/enums/client_kind.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/repositories/i_bridge_replica_repository.dart';
import 'package:uxnan/domain/value_objects/client_presence.dart';
import 'package:uxnan/domain/value_objects/replica_cursor.dart';

/// This phone's copy of what the connected PC's bridge shares — its
/// conversations, its project registry (the same list Uxnan Desktop shows on
/// that PC), its start folder and who is connected — kept converged
/// (architecture/02a §5.8.17).
///
/// The bridge numbers every change with one global revision. This replica
/// remembers the last one applied per PC and asks `sync/changes { since }`:
///
/// - whenever the connection comes up (a new process, minutes away, a bridge
///   restart — whatever the live replay did or did not carry);
/// - whenever a notification's revision is not the one after the last applied
///   (something was missed in between).
///
/// Before reading, it sends what the user did here while that PC was out of
/// reach ([ThreadActionOutbox]), each action dated so the latest one wins.
///
/// So a conversation or a project started on Uxnan Desktop while the phone was
/// asleep, or before it was ever paired, is here when it connects — the
/// replay window alone could not promise that. A revisioned change is only
/// applied if it is newer than what the replica holds, so a late notification
/// can never undo a newer state.
class BridgeReplica {
  /// Creates a [BridgeReplica].
  BridgeReplica({
    required IBridgeReplicaRepository repository,
    required ThreadManager threadManager,
    required RpcSend sendRequest,
    required Stream<DomainEvent> domainEvents,
    required String? Function() currentDeviceId,
    Stream<ConnectionPhase>? connectionPhases,
    ThreadActionOutbox? outbox,
  })  : _repository = repository,
        _threads = threadManager,
        _sendRequest = sendRequest,
        _currentDeviceId = currentDeviceId,
        _outbox = outbox {
    _eventsSub = domainEvents.listen(_onEvent);
    _phaseSub = connectionPhases?.listen(_onPhase);
  }

  final IBridgeReplicaRepository _repository;
  final ThreadManager _threads;
  final RpcSend _sendRequest;
  final String? Function() _currentDeviceId;
  final ThreadActionOutbox? _outbox;
  late final StreamSubscription<DomainEvent> _eventsSub;
  StreamSubscription<ConnectionPhase>? _phaseSub;

  final BehaviorSubject<List<ClientPresence>> _presence =
      BehaviorSubject.seeded(const []);
  final BehaviorSubject<String?> _home = BehaviorSubject.seeded(null);
  final PublishSubject<void> _agentsChanged = PublishSubject<void>();

  /// The cursor of the connected PC, as last applied (in memory).
  ReplicaCursor? _cursor;
  String? _cursorDevice;
  Future<void>? _syncing;
  bool _syncAgain = false;
  ConnectionPhase? _phase;
  bool _disposed = false;

  /// Who is connected to the PC's bridge right now (phones, Uxnan Desktop).
  Stream<List<ClientPresence>> get presenceStream => _presence.stream;

  /// The PC's shared start folder, when known.
  Stream<String?> get homeStream => _home.stream;

  /// Fires when the PC's installed agents changed (re-read `agent/list`).
  Stream<void> get agentsChanged => _agentsChanged.stream;

  /// Whether Uxnan Desktop is connected to this PC's bridge right now.
  bool get desktopLinked =>
      _presence.value.any((c) => c.kind == ClientKind.desktop);

  /// The projects of [deviceId], by name — the list Uxnan Desktop shows too.
  Stream<List<Project>> projectsOf(String deviceId) =>
      _repository.watchProjects(deviceId);

  void _onPhase(ConnectionPhase phase) {
    final was = _phase;
    _phase = phase;
    if (phase == ConnectionPhase.connected &&
        was != ConnectionPhase.connected) {
      unawaited(sync());
    } else if (phase != ConnectionPhase.connected) {
      _presence.add(const []);
    }
  }

  /// Converge with the connected PC's bridge. Calls that arrive while one runs
  /// are folded into one more pass afterwards. Never throws.
  Future<void> sync() {
    final running = _syncing;
    if (running != null) {
      _syncAgain = true;
      return running;
    }
    final run = _syncLoop();
    _syncing = run;
    return run.whenComplete(() => _syncing = null);
  }

  Future<void> _syncLoop() async {
    do {
      _syncAgain = false;
      final deviceId = _currentDeviceId();
      if (deviceId == null || _disposed) return;
      try {
        // What the user did here while this PC was out of reach goes first:
        // the bridge's state is read only once it has heard all of it, so a
        // snapshot can never undo an action it has not received yet.
        final outbox = _outbox;
        if (outbox != null && !await outbox.flush(deviceId, _sendRequest)) {
          return;
        }
        final cursor = await _cursorFor(deviceId);
        final response = await _sendRequest('sync/changes', {
          if (cursor != null) 'since': cursor.rev,
          if (cursor != null) 'storeId': cursor.storeId,
        });
        final result = response.result;
        if (result is! Map) continue;
        await _apply(deviceId, result.cast<String, dynamic>());
      } on Object catch (error, stackTrace) {
        AppLogger.warn('sync/changes failed', error, stackTrace);
      }
    } while (_syncAgain && !_disposed);
  }

  Future<void> _apply(String deviceId, Map<String, dynamic> changes) async {
    final reset = changes['reset'] == true;
    final threads = changes['threads'];
    final removedThreads = _strings(changes['removedThreadIds']);
    await _threads.applyReplicaThreads(
      deviceId: deviceId,
      threads: threads is List ? threads : const [],
      removedIds: removedThreads,
      reset: reset,
    );
    final projects = [
      for (final raw in changes['projects'] as List? ?? const [])
        if (raw is Map) Project.fromJson(raw.cast<String, dynamic>()),
    ];
    if (reset) {
      await _repository.replaceProjects(deviceId, projects);
    } else {
      await _repository.upsertProjects(deviceId, projects);
      await _repository.deleteProjects(
        deviceId,
        _strings(changes['removedProjectIds']),
      );
    }
    final settings = changes['settings'];
    final home = switch (settings) {
      {'home': final String home} => home,
      _ => null,
    };
    _home.add(home);
    _presence.add(ClientPresence.listFromJson(changes['clients']));
    final storeId = changes['storeId'];
    final rev = changes['rev'];
    if (storeId is String && rev is int) {
      await _saveCursor(
        deviceId,
        ReplicaCursor(storeId: storeId, rev: rev, home: home),
      );
    }
  }

  Future<ReplicaCursor?> _cursorFor(String deviceId) async {
    if (_cursorDevice != deviceId) {
      _cursorDevice = deviceId;
      _cursor = await _repository.cursor(deviceId);
      _home.add(_cursor?.home);
    }
    return _cursor;
  }

  Future<void> _saveCursor(String deviceId, ReplicaCursor cursor) async {
    _cursorDevice = deviceId;
    _cursor = cursor;
    await _repository.saveCursor(deviceId, cursor);
  }

  /// Whether a change carrying [rev] should be applied now. The next revision
  /// is taken (and remembered); one further ahead means something was missed,
  /// so the replica catches up — the change itself is still applied, the sync
  /// brings the rest; an older one is stale and dropped.
  Future<bool> _admit(String deviceId, int? rev) async {
    final cursor = await _cursorFor(deviceId);
    if (rev == null) return true;
    if (cursor == null) {
      unawaited(sync());
      return true;
    }
    if (rev <= cursor.rev) return false;
    if (rev == cursor.rev + 1) {
      await _saveCursor(deviceId, cursor.copyWith(rev: rev));
      return true;
    }
    unawaited(sync());
    return true;
  }

  void _onEvent(DomainEvent event) {
    final deviceId = _currentDeviceId();
    if (deviceId == null || _disposed) return;
    switch (event) {
      case ThreadUpdatedEvent(:final thread):
        unawaited(
          _whenAdmitted(deviceId, thread['rev'], () {
            return _threads.applyReplicaThreads(
              deviceId: deviceId,
              threads: [thread],
              removedIds: const [],
              reset: false,
            );
          }),
        );
      case ThreadDeletedEvent(:final threadId, :final rev):
        if (threadId == null) return;
        unawaited(
          _whenAdmitted(deviceId, rev, () {
            return _threads.applyReplicaThreads(
              deviceId: deviceId,
              threads: const [],
              removedIds: [threadId],
              reset: false,
            );
          }),
        );
      case ProjectUpdatedEvent(:final project):
        unawaited(
          _whenAdmitted(deviceId, project['rev'], () {
            return _repository.upsertProjects(deviceId, [
              Project.fromJson(project),
            ]);
          }),
        );
      case ProjectRemovedEvent(:final projectId, :final rev):
        unawaited(
          _whenAdmitted(deviceId, rev, () {
            return _repository.deleteProjects(deviceId, [projectId]);
          }),
        );
      case SettingsUpdatedEvent(:final home, :final rev):
        unawaited(
          _whenAdmitted(deviceId, rev, () async {
            _home.add(home);
            final cursor = _cursor;
            if (cursor != null) {
              await _saveCursor(deviceId, cursor.copyWith(home: home));
            }
          }),
        );
      case PresenceUpdatedEvent(:final clients):
        _presence.add(ClientPresence.listFromJson(clients));
      case AgentsUpdatedEvent():
        _agentsChanged.add(null);
      default:
        break;
    }
  }

  Future<void> _whenAdmitted(
    String deviceId,
    Object? rev,
    Future<void> Function() apply,
  ) async {
    try {
      if (await _admit(deviceId, rev is int ? rev : null)) await apply();
    } on Object catch (error, stackTrace) {
      AppLogger.warn('applying a bridge change failed', error, stackTrace);
    }
  }

  /// Registers the folder at [cwd] as a project of the PC (`project/add`) —
  /// the same list Uxnan Desktop shows. The phone may register folders inside
  /// the PC's start folder. Returns the project, or `null` when refused.
  Future<Project?> addProject(String cwd, {String? name}) async {
    final response = await _sendRequest('project/add', {
      'cwd': cwd,
      if (name != null) 'name': name,
    });
    final result = response.result;
    if (result is! Map) return null;
    final project = Project.fromJson(result.cast<String, dynamic>());
    final deviceId = _currentDeviceId();
    if (deviceId != null) {
      await _repository.upsertProjects(deviceId, [project]);
    }
    return project;
  }

  /// Removes a project from the PC's registry (`project/remove`) — here and in
  /// Uxnan Desktop. Its conversations are never deleted.
  Future<void> removeProject(String projectId) async {
    await _sendRequest('project/remove', {'projectId': projectId});
    final deviceId = _currentDeviceId();
    if (deviceId != null) {
      await _repository.deleteProjects(deviceId, [projectId]);
    }
  }

  /// Renames a project; an empty name restores the folder's.
  Future<void> renameProject(String projectId, String name) async {
    final response = await _sendRequest('project/rename', {
      'projectId': projectId,
      'name': name,
    });
    final result = response.result;
    final deviceId = _currentDeviceId();
    if (result is Map && deviceId != null) {
      await _repository.upsertProjects(deviceId, [
        Project.fromJson(result.cast<String, dynamic>()),
      ]);
    }
  }

  /// Changes the PC's shared start folder (`settings/set`) — for every client.
  Future<void> setHome(String home) async {
    final response = await _sendRequest('settings/set', {'home': home});
    final result = response.result;
    if (result is Map && result['home'] is String) {
      _home.add(result['home'] as String);
    }
  }

  /// Forgets everything kept for [deviceId] (the PC was removed).
  Future<void> forgetDevice(String deviceId) async {
    await _repository.forgetDevice(deviceId);
    if (_cursorDevice == deviceId) {
      _cursorDevice = null;
      _cursor = null;
    }
  }

  static List<String> _strings(Object? value) => [
        if (value is List)
          for (final item in value)
            if (item is String) item,
      ];

  /// Releases resources.
  Future<void> dispose() async {
    _disposed = true;
    await _eventsSub.cancel();
    await _phaseSub?.cancel();
    await _presence.close();
    await _home.close();
    await _agentsChanged.close();
  }
}
