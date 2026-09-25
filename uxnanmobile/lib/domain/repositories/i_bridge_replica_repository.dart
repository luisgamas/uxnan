import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/value_objects/pending_action.dart';
import 'package:uxnan/domain/value_objects/replica_cursor.dart';

/// Contract for this phone's copy of what each paired PC's bridge shares
/// besides conversations: its project registry, how far the copy has caught
/// up, and the actions still waiting to reach it (architecture/02a §5.8.17).
/// Conversations live in [IThreadRepository].
///
/// Every PC keeps its own copy: two PCs can have a project at the same path.
abstract class IBridgeReplicaRepository {
  /// How far the copy of [deviceId] has caught up, or `null` before the first
  /// sync.
  Future<ReplicaCursor?> cursor(String deviceId);

  /// Records how far the copy of [deviceId] has caught up.
  Future<void> saveCursor(String deviceId, ReplicaCursor cursor);

  /// The projects of [deviceId], by name, whenever they change.
  Stream<List<Project>> watchProjects(String deviceId);

  /// Inserts or updates [projects] for [deviceId].
  Future<void> upsertProjects(String deviceId, List<Project> projects);

  /// Removes the projects with [ids] from [deviceId].
  Future<void> deleteProjects(String deviceId, List<String> ids);

  /// Replaces every project of [deviceId] with [projects] (a full snapshot).
  Future<void> replaceProjects(String deviceId, List<Project> projects);

  /// Keeps [action] until it can be sent, dropping what it makes moot on the
  /// same target ([PendingActionKind.supersedes]).
  Future<void> enqueueAction(PendingAction action);

  /// The actions waiting for [deviceId], in the order they were taken.
  Future<List<PendingAction>> pendingActions(String deviceId);

  /// Drops the kept action [id] (it was sent, or the bridge refused it).
  Future<void> removeAction(int id);

  /// Forgets everything kept for [deviceId] (the PC was removed).
  Future<void> forgetDevice(String deviceId);
}
