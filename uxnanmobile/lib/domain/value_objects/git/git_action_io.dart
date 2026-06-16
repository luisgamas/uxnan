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

/// Parameters for a `git/pull` request.
class GitPullParams extends Equatable {
  /// Creates a [GitPullParams].
  const GitPullParams({
    required this.cwd,
    this.remote,
    this.branch,
    this.threadId,
  });

  /// Working directory the pull runs in.
  final String cwd;

  /// Remote to pull from (defaults to the branch's upstream when null).
  final String? remote;

  /// Branch to pull (defaults to the current branch when null).
  final String? branch;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() => {
        'cwd': cwd,
        if (remote != null) 'remote': remote,
        if (branch != null) 'branch': branch,
      };

  @override
  List<Object?> get props => [cwd, remote, branch, threadId];
}

/// Result of a successful `git/pull`.
class GitPullResult extends Equatable {
  /// Creates a [GitPullResult].
  const GitPullResult({this.success = false});

  /// Reconstructs a [GitPullResult] from its JSON form.
  factory GitPullResult.fromJson(Map<String, dynamic> json) =>
      GitPullResult(success: json['success'] == true);

  /// Whether the pull completed successfully.
  final bool success;

  @override
  List<Object?> get props => [success];
}

/// Parameters for a `git/checkout` request (switch to an existing branch).
class GitCheckoutParams extends Equatable {
  /// Creates a [GitCheckoutParams].
  const GitCheckoutParams({
    required this.cwd,
    required this.branch,
    this.threadId,
  });

  /// Working directory the checkout runs in.
  final String cwd;

  /// The branch to check out.
  final String branch;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() => {'cwd': cwd, 'branch': branch};

  @override
  List<Object?> get props => [cwd, branch, threadId];
}

/// Parameters for a `git/createBranch` request.
class GitBranchParams extends Equatable {
  /// Creates a [GitBranchParams].
  const GitBranchParams({
    required this.cwd,
    required this.name,
    this.threadId,
  });

  /// Working directory the branch is created in.
  final String cwd;

  /// New branch name.
  final String name;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() => {'cwd': cwd, 'name': name};

  @override
  List<Object?> get props => [cwd, name, threadId];
}

/// Result of a successful `git/createBranch`.
class GitBranchResult extends Equatable {
  /// Creates a [GitBranchResult].
  const GitBranchResult({this.branch = ''});

  /// Reconstructs a [GitBranchResult] from its JSON form.
  factory GitBranchResult.fromJson(Map<String, dynamic> json) =>
      GitBranchResult(branch: json['branch'] as String? ?? '');

  /// The created branch's name.
  final String branch;

  @override
  List<Object?> get props => [branch];
}

/// Parameters for a `git/createWorktree` request.
///
/// FOR-DEV: the bridge requires an explicit [path] and does not yet implement
/// managed worktrees (auto-path) — so [path] is derived on the phone from the
/// repo `cwd` + branch. When the bridge gains managed-worktree support (pick
/// the path itself), drop the derived path and rely on [managed].
class GitWorktreeParams extends Equatable {
  /// Creates a [GitWorktreeParams].
  const GitWorktreeParams({
    required this.cwd,
    required this.branch,
    required this.path,
    this.managed = true,
    this.threadId,
  });

  /// Working directory the worktree is created from.
  final String cwd;

  /// Branch to create/check out in the worktree.
  final String branch;

  /// Absolute path of the new worktree.
  final String path;

  /// Whether the worktree is uxnan-managed (forwarded for future bridge use).
  final bool managed;

  /// Owning thread, used to record the action in the local log.
  final String? threadId;

  /// The JSON-RPC params for the bridge (`threadId` is local-only).
  Map<String, dynamic> toRpcParams() =>
      {'cwd': cwd, 'branch': branch, 'path': path, 'managed': managed};

  @override
  List<Object?> get props => [cwd, branch, path, managed, threadId];
}

/// Result of a successful `git/createWorktree`.
class GitWorktreeResult extends Equatable {
  /// Creates a [GitWorktreeResult].
  const GitWorktreeResult({this.path = '', this.branch = ''});

  /// Reconstructs a [GitWorktreeResult] from its JSON form.
  factory GitWorktreeResult.fromJson(Map<String, dynamic> json) =>
      GitWorktreeResult(
        path: json['path'] as String? ?? '',
        branch: json['branch'] as String? ?? '',
      );

  /// Absolute path of the created worktree.
  final String path;

  /// Branch checked out in the worktree.
  final String branch;

  @override
  List<Object?> get props => [path, branch];
}
