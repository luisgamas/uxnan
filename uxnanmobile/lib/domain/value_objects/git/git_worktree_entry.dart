import 'package:equatable/equatable.dart';

/// One entry of the bridge's `git/worktrees` reply.
///
/// A worktree can live **anywhere**: beside its repository (`../repo-feature`),
/// grouped under the folder uxnan manages (`~/uxnan/worktrees/<repo>/<branch>`),
/// or wherever the user put it. None of those is a child of the main worktree,
/// and the grouped one shares a prefix with worktrees of OTHER repositories.
/// That is exactly why the phone cannot infer the hierarchy and has to be told
/// — and why an older bridge, which cannot tell it, leaves the list flat
/// instead of guessing from prefixes.
class GitWorktreeEntry extends Equatable {
  /// Creates a [GitWorktreeEntry].
  const GitWorktreeEntry({
    required this.path,
    required this.isMain,
    this.branch,
    this.isLocked = false,
  });

  /// Parses one entry, tolerating a bridge that omits the optional fields.
  factory GitWorktreeEntry.fromJson(Map<String, dynamic> json) {
    final branch = json['branch'];
    return GitWorktreeEntry(
      path: json['path'] as String? ?? '',
      isMain: json['isMain'] == true,
      branch: branch is String && branch.isNotEmpty ? branch : null,
      isLocked: json['isLocked'] == true,
    );
  }

  /// Absolute path of the worktree.
  final String path;

  /// Whether this is the repository's main worktree.
  final bool isMain;

  /// Checked-out branch; null on a detached HEAD.
  final String? branch;

  /// Whether `git worktree lock` has been applied.
  final bool isLocked;

  @override
  List<Object?> get props => [path, isMain, branch, isLocked];
}
