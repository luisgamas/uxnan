import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';

/// A push-style notification that a `git/status` fetch just produced a new
/// [GitRepoState] for [cwd].
///
/// Emitted by anything that drives a `git/status` RPC (the [GitActionManager]
/// after every commit/push/pull/etc, the [FileBrowserManager] on its own
/// refresh) so that **any** consumer can repaint without each having to
/// re-fetch. The payload carries the parsed state — listeners do not need to
/// re-issue the RPC.
///
/// **Scope.** A change is scoped to a single workspace (`cwd`). Listeners
/// ignore events whose `cwd` they do not manage.
class GitStatusChange extends Equatable {
  /// Creates a [GitStatusChange].
  const GitStatusChange({required this.cwd, required this.state});

  /// The workspace root the status was fetched for (the absolute path the
  /// bridge was given).
  final String cwd;

  /// The freshly-parsed [GitRepoState] for [cwd].
  final GitRepoState state;

  @override
  List<Object?> get props => [cwd, state];
}
