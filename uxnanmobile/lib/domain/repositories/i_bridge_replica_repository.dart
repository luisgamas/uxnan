import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/value_objects/replica_cursor.dart';

/// Contract for this phone's copy of what each paired PC's bridge shares
/// besides conversations: its project registry and how far the copy has caught
/// up (architecture/02a §5.8.17). Conversations live in [IThreadRepository].
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

  /// Forgets everything kept for [deviceId] (the PC was removed).
  Future<void> forgetDevice(String deviceId);
}
