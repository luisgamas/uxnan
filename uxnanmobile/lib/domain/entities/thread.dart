import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';

/// A conversation thread handled by a coding agent.
///
/// Mirrors the entity defined in `architecture/02a-system-architecture.md`
/// (section 5.1.1). [agentId] holds the agent's wire identifier (see
/// `AgentId.wireId`) so a thread is portable across adapters.
class Thread extends Equatable {
  /// Creates a [Thread].
  const Thread({
    required this.id,
    required this.title,
    required this.agentId,
    required this.syncState,
    required this.status,
    this.projectId,
    this.cwd,
    this.worktreePath,
    this.lastActivity,
  });

  /// Unique thread identifier.
  final String id;

  /// Human readable thread title.
  final String title;

  /// Identifier of the project this thread belongs to, if any.
  final String? projectId;

  /// Working directory of the thread on the PC, if known.
  final String? cwd;

  /// Path of the git worktree backing this thread, if any.
  final String? worktreePath;

  /// Local-vs-bridge synchronization state.
  final ThreadSyncState syncState;

  /// High-level thread status.
  final ThreadStatus status;

  /// Timestamp of the last activity in the thread, if any.
  final DateTime? lastActivity;

  /// Wire identifier of the agent that handles this thread.
  final String agentId;

  /// Returns a copy of this thread with the given fields replaced.
  Thread copyWith({
    String? title,
    String? projectId,
    String? cwd,
    String? worktreePath,
    ThreadSyncState? syncState,
    ThreadStatus? status,
    DateTime? lastActivity,
    String? agentId,
  }) {
    return Thread(
      id: id,
      title: title ?? this.title,
      projectId: projectId ?? this.projectId,
      cwd: cwd ?? this.cwd,
      worktreePath: worktreePath ?? this.worktreePath,
      syncState: syncState ?? this.syncState,
      status: status ?? this.status,
      lastActivity: lastActivity ?? this.lastActivity,
      agentId: agentId ?? this.agentId,
    );
  }

  @override
  List<Object?> get props => [
        id,
        title,
        projectId,
        cwd,
        worktreePath,
        syncState,
        status,
        lastActivity,
        agentId,
      ];
}
