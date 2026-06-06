import 'package:uxnan/domain/entities/git/git_action_log_entry.dart';

/// Contract for persisting and observing git action history (spec 02c §10.1).
abstract class IGitActionLogRepository {
  /// Inserts or updates [entry].
  Future<void> record(GitActionLogEntry entry);

  /// Returns the log entries for [threadId], most recent first.
  Future<List<GitActionLogEntry>> getForThread(String threadId);

  /// Emits the log entries for [threadId] whenever they change, most recent
  /// first.
  Stream<List<GitActionLogEntry>> watchForThread(String threadId);
}
