import 'package:equatable/equatable.dart';

/// Parameters for a `git/commit` request (spec 02a §5.5).
class GitCommitParams extends Equatable {
  /// Creates a [GitCommitParams].
  const GitCommitParams({
    required this.cwd,
    required this.message,
    this.threadId,
  });

  /// Working directory the commit runs in.
  final String cwd;

  /// The commit message.
  final String message;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() => {'cwd': cwd, 'message': message};

  @override
  List<Object?> get props => [cwd, message, threadId];
}

/// Parameters for a `git/push` request (spec 02a §5.5).
class GitPushParams extends Equatable {
  /// Creates a [GitPushParams].
  const GitPushParams({
    required this.cwd,
    required this.branch,
    this.remote = 'origin',
    this.threadId,
  });

  /// Working directory the push runs in.
  final String cwd;

  /// The branch to push.
  final String branch;

  /// The remote to push to (defaults to `origin`).
  final String remote;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() =>
      {'cwd': cwd, 'branch': branch, 'remote': remote};

  @override
  List<Object?> get props => [cwd, branch, remote, threadId];
}

/// Result of a successful `git/commit` (spec 02a §5.5).
class GitCommitResult extends Equatable {
  /// Creates a [GitCommitResult].
  const GitCommitResult({required this.sha, required this.message});

  /// Reconstructs a [GitCommitResult] from its JSON form.
  factory GitCommitResult.fromJson(Map<String, dynamic> json) =>
      GitCommitResult(
        sha: json['sha'] as String? ?? '',
        message: json['message'] as String? ?? '',
      );

  /// The new commit's SHA.
  final String sha;

  /// The commit message that was recorded.
  final String message;

  @override
  List<Object?> get props => [sha, message];
}

/// Result of a successful `git/push` (spec 02a §5.5).
class GitPushResult extends Equatable {
  /// Creates a [GitPushResult].
  const GitPushResult({required this.branch, required this.remote});

  /// Reconstructs a [GitPushResult] from its JSON form.
  factory GitPushResult.fromJson(Map<String, dynamic> json) => GitPushResult(
        branch: json['branch'] as String? ?? '',
        remote: json['remote'] as String? ?? 'origin',
      );

  /// The branch that was pushed.
  final String branch;

  /// The remote it was pushed to.
  final String remote;

  @override
  List<Object?> get props => [branch, remote];
}
