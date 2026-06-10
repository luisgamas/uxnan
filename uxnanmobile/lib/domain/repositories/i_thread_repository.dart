import 'package:uxnan/domain/entities/thread.dart';

/// Contract for persisting and observing conversation [Thread]s.
///
/// Defined in `architecture/02a-system-architecture.md` (section 5.1.4). The
/// drift-backed implementation lives in `infrastructure/repositories/`.
abstract class IThreadRepository {
  /// Returns all threads, optionally filtered by [projectId], most recently
  /// active first.
  Future<List<Thread>> getThreads({String? projectId});

  /// Returns the thread with the given [id], or `null` if absent.
  Future<Thread?> getThread(String id);

  /// Inserts or updates [thread].
  Future<void> saveThread(Thread thread);

  /// Deletes the thread with the given [id].
  Future<void> deleteThread(String id);

  /// Deletes every thread belonging to [deviceId] (a paired PC), along with
  /// their messages and turns. Used when removing a device.
  Future<void> deleteThreadsByDeviceId(String deviceId);

  /// Emits the thread list whenever it changes, optionally filtered by
  /// [projectId].
  Stream<List<Thread>> watchThreads({String? projectId});
}
