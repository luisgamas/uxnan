import 'dart:math';

import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/repositories/i_bridge_replica_repository.dart';
import 'package:uxnan/domain/value_objects/pending_thread_action.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// Conversation actions this phone took while their PC was out of reach —
/// rename, archive, unarchive, delete — kept on disk and sent when it is
/// reachable again, before anything else is read from it (architecture/02a
/// §5.8.17).
///
/// Each one travels with how long ago it was decided (`ageMs`), and the bridge
/// applies it only if nothing decided the same thing later on another client:
/// the latest action wins, whichever device took it. An age rather than a
/// time, so this phone's clock never has to agree with the PC's.
class ThreadActionOutbox {
  /// Creates a [ThreadActionOutbox].
  ThreadActionOutbox({
    required IBridgeReplicaRepository repository,
    DateTime Function()? clock,
  })  : _repository = repository,
        _clock = clock ?? DateTime.now;

  final IBridgeReplicaRepository _repository;
  final DateTime Function() _clock;

  /// Keeps [action] for its PC, stamped now.
  Future<void> keep({
    required String deviceId,
    required String threadId,
    required PendingThreadActionKind kind,
    String? title,
  }) =>
      _repository.enqueueThreadAction(
        PendingThreadAction(
          deviceId: deviceId,
          threadId: threadId,
          kind: kind,
          title: title,
          decidedAt: _clock(),
        ),
      );

  /// Sends what is waiting for [deviceId], oldest first. An action the bridge
  /// refuses (the conversation was deleted elsewhere, say) is dropped: there
  /// is nothing left to retry. Resolves `false` when the PC went out of reach
  /// again, keeping the rest for the next time — a caller must not read the
  /// bridge's state over actions it has not heard yet.
  Future<bool> flush(String deviceId, RpcSend send) async {
    for (final action in await _repository.pendingThreadActions(deviceId)) {
      final ageMs =
          max(0, _clock().difference(action.decidedAt).inMilliseconds);
      try {
        final response =
            await send(action.kind.method, action.params(ageMs: ageMs));
        if (response.error case final RpcError refused) {
          AppLogger.warn(
            '${action.kind.method} sent late was refused (dropped)',
            refused,
          );
        }
      } on RpcError catch (error, stackTrace) {
        AppLogger.warn(
          '${action.kind.method} sent late was refused (dropped)',
          error,
          stackTrace,
        );
      } on Object catch (error, stackTrace) {
        AppLogger.warn(
          '${action.kind.method} sent late did not arrive (kept)',
          error,
          stackTrace,
        );
        return false;
      }
      await _repository.removeThreadAction(action.id!);
    }
    return true;
  }
}
