import 'package:equatable/equatable.dart';

/// Parameters for a `git/commit` request (spec 02a §5.5).
class GitCommitParams extends Equatable {
  /// Creates a [GitCommitParams].
  const GitCommitParams({
    required this.cwd,
    required this.message,
    this.paths = const [],
    this.threadId,
  });

  /// Working directory the commit runs in.
  final String cwd;

  /// The commit message (already includes any Co-authored-by trailer).
  final String message;

  /// Repository-relative paths to stage before committing. Empty means stage
  /// the whole working tree (`git add -A`).
  final List<String> paths;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() => {
        'cwd': cwd,
        'message': message,
        if (paths.isNotEmpty) 'paths': paths,
      };

  @override
  List<Object?> get props => [cwd, message, paths, threadId];
}

/// Parameters for a `git/discard` request — destructive, callers confirm first.
class GitDiscardParams extends Equatable {
  /// Creates a [GitDiscardParams].
  const GitDiscardParams({
    required this.cwd,
    required this.paths,
    this.threadId,
  });

  /// Working directory the discard runs in.
  final String cwd;

  /// Repository-relative paths whose changes are discarded.
  final List<String> paths;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() => {'cwd': cwd, 'paths': paths};

  @override
  List<Object?> get props => [cwd, paths, threadId];
}

/// Parameters for a `git/createPr` request.
class GitPrParams extends Equatable {
  /// Creates a [GitPrParams].
  const GitPrParams({
    required this.cwd,
    required this.title,
    this.body,
    this.base,
    this.head,
    this.threadId,
  });

  /// Working directory the PR is opened from.
  final String cwd;

  /// PR title.
  final String title;

  /// PR body/description.
  final String? body;

  /// Base/target branch (defaults to the host's default when null).
  final String? base;

  /// Head/source branch (defaults to the current branch). The bridge pushes it
  /// to the remote before opening the PR.
  final String? head;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() => {
        'cwd': cwd,
        'title': title,
        if (body != null) 'body': body,
        if (base != null) 'base': base,
        if (head != null) 'head': head,
      };

  @override
  List<Object?> get props => [cwd, title, body, base, head, threadId];
}

/// The current/local/remote branches of a repository (`git/branches`).
class GitBranchList extends Equatable {
  /// Creates a [GitBranchList].
  const GitBranchList({
    this.current = '',
    this.local = const [],
    this.remote = const [],
  });

  /// Reconstructs a [GitBranchList] from a `git/branches` JSON result.
  factory GitBranchList.fromJson(Map<String, dynamic> json) => GitBranchList(
        current: json['current'] as String? ?? '',
        local: _strings(json['local']),
        remote: _strings(json['remote']),
      );

  /// Currently checked-out branch.
  final String current;

  /// Local branch names.
  final List<String> local;

  /// Remote-tracking branch names (e.g. `origin/main`).
  final List<String> remote;

  static List<String> _strings(Object? raw) => [
        if (raw is List)
          for (final v in raw)
            if (v is String) v,
      ];

  @override
  List<Object?> get props => [current, local, remote];
}

/// Result of a successful `git/createPr`.
class GitPrResult extends Equatable {
  /// Creates a [GitPrResult].
  const GitPrResult({required this.url, this.number});

  /// Reconstructs a [GitPrResult] from its JSON form.
  factory GitPrResult.fromJson(Map<String, dynamic> json) => GitPrResult(
        url: json['url'] as String? ?? '',
        number: json['number'] is num ? (json['number'] as num).toInt() : null,
      );

  /// URL of the created pull request.
  final String url;

  /// PR number, when reported by the host CLI.
  final int? number;

  @override
  List<Object?> get props => [url, number];
}

/// A single file's unified diff (`git/diff` with a `path`).
class GitFileDiff extends Equatable {
  /// Creates a [GitFileDiff].
  const GitFileDiff({
    this.diff = '',
    this.additions = 0,
    this.deletions = 0,
  });

  /// Reconstructs a [GitFileDiff] from a `git/diff` JSON result.
  factory GitFileDiff.fromJson(Map<String, dynamic> json) => GitFileDiff(
        diff: json['diff'] as String? ?? '',
        additions:
            json['additions'] is num ? (json['additions'] as num).toInt() : 0,
        deletions:
            json['deletions'] is num ? (json['deletions'] as num).toInt() : 0,
      );

  /// Unified diff text for the file.
  final String diff;

  /// Lines added.
  final int additions;

  /// Lines removed.
  final int deletions;

  @override
  List<Object?> get props => [diff, additions, deletions];
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
