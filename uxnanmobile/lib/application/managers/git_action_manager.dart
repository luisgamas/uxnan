import 'dart:async';
import 'dart:convert';

import 'package:rxdart/rxdart.dart';
import 'package:uuid/uuid.dart';
import 'package:uxnan/application/managers/thread_manager.dart' show RpcSend;
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/application/services/git_status_bus.dart';
import 'package:uxnan/domain/entities/git/git_action_log_entry.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_action_kind.dart';
import 'package:uxnan/domain/repositories/i_git_action_log_repository.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';
import 'package:uxnan/domain/value_objects/git/git_action_progress.dart';
import 'package:uxnan/domain/value_objects/git/git_status_change.dart';

/// Coordinates git actions for the active workspace (spec 02a §5.2.4).
///
/// Reads repository state through the injected [RpcSend] (`git/status`) and runs
/// commit/push, exposing the in-flight [GitActionProgress] which accumulates
/// `stream/git/progress` events arriving on [DomainEvent]s. Completed actions
/// are recorded in the local action log.
///
/// Adaptation note: the spec exposes `ValueNotifier`s; like the other managers
/// this exposes streams (`BehaviorSubject`) to fit Riverpod 3.x.
class GitActionManager {
  /// Creates a [GitActionManager].
  ///
  /// [statusBus] (optional, recommended) receives a [GitStatusChange] after
  /// every successful [refreshStatus] so consumers like the file browser can
  /// repaint from the payload without re-fetching `git/status` themselves.
  /// In production the bus is the shared `gitStatusBusProvider`; tests may
  /// pass their own or `null` (which silently skips the broadcast — useful
  /// for tests that do not care about cross-manager propagation).
  GitActionManager({
    required RpcSend sendRequest,
    required Stream<DomainEvent> domainEvents,
    IGitActionLogRepository? actionLog,
    GitStatusBus? statusBus,
    Uuid? uuid,
  })  : _sendRequest = sendRequest,
        _actionLog = actionLog,
        _statusBus = statusBus,
        _uuid = uuid ?? const Uuid() {
    _eventsSub = domainEvents.listen(_applyEvent);
  }

  final RpcSend _sendRequest;
  final IGitActionLogRepository? _actionLog;
  final GitStatusBus? _statusBus;
  final Uuid _uuid;
  late final StreamSubscription<DomainEvent> _eventsSub;

  final BehaviorSubject<GitRepoState?> _repoState =
      BehaviorSubject.seeded(null);
  final BehaviorSubject<GitActionProgress?> _activeAction =
      BehaviorSubject.seeded(null);
  final BehaviorSubject<bool> _isLoading = BehaviorSubject.seeded(false);

  /// The latest repository state, or null until first fetched.
  Stream<GitRepoState?> get repoStateStream => _repoState.stream;

  /// The in-flight git action's progress, or null when idle.
  Stream<GitActionProgress?> get activeActionStream => _activeAction.stream;

  /// Whether a status refresh is in flight.
  Stream<bool> get isLoadingStream => _isLoading.stream;

  /// The latest repository state snapshot.
  GitRepoState? get repoState => _repoState.value;

  /// The in-flight action snapshot.
  GitActionProgress? get activeAction => _activeAction.value;

  /// Fetches `git/status` for [cwd], publishes the parsed [GitRepoState],
  /// and broadcasts it on the [GitStatusBus] (when wired) so any other
  /// consumer — typically the file browser — can repaint from the payload
  /// without re-fetching.
  Future<GitRepoState?> refreshStatus(String cwd) async {
    _isLoading.add(true);
    try {
      final response = await _sendRequest('git/status', {'cwd': cwd});
      final result = response.result;
      if (result is! Map) return null;
      final state = GitRepoState.fromJson(result.cast<String, dynamic>());
      _repoState.add(state);
      _statusBus?.emit(GitStatusChange(cwd: cwd, state: state));
      return state;
    } finally {
      _isLoading.add(false);
    }
  }

  /// Commits the working tree with [params] and refreshes status.
  Future<GitCommitResult?> commit(GitCommitParams params) {
    return _run(
      kind: GitActionKind.commit,
      method: 'git/commit',
      rpcParams: params.toRpcParams(),
      threadId: params.threadId,
      cwd: params.cwd,
      parseResult: GitCommitResult.fromJson,
    );
  }

  /// Pushes the branch in [params] to its remote, surfacing per-phase
  /// progress, and refreshes status.
  Future<GitPushResult?> push(GitPushParams params) {
    return _run(
      kind: GitActionKind.push,
      method: 'git/push',
      rpcParams: params.toRpcParams(),
      threadId: params.threadId,
      cwd: params.cwd,
      parseResult: GitPushResult.fromJson,
    );
  }

  /// Fetches the unified diff for a single [path] within [cwd]. Returns an
  /// empty diff when the bridge has nothing to show.
  Future<GitFileDiff> fileDiff(String cwd, String path) async {
    final response = await _sendRequest('git/diff', {'cwd': cwd, 'path': path});
    final result = response.result;
    if (result is! Map) return const GitFileDiff();
    return GitFileDiff.fromJson(result.cast<String, dynamic>());
  }

  /// Discards working-tree changes for [params]'s paths and refreshes status.
  /// Destructive — the UI must confirm before calling this.
  Future<void> discard(GitDiscardParams params) {
    return _run(
      kind: GitActionKind.discard,
      method: 'git/discard',
      rpcParams: params.toRpcParams(),
      threadId: params.threadId,
      cwd: params.cwd,
      parseResult: (_) {},
    );
  }

  /// Opens a pull request for [params] and refreshes status.
  Future<GitPrResult?> createPr(GitPrParams params) {
    return _run(
      kind: GitActionKind.createPr,
      method: 'git/createPr',
      rpcParams: params.toRpcParams(),
      threadId: params.threadId,
      cwd: params.cwd,
      parseResult: GitPrResult.fromJson,
    );
  }

  /// Undoes the last commit in [cwd] (soft reset) and refreshes status. The
  /// committed changes are kept so the user can re-adjust before pushing.
  Future<void> undoCommit(String cwd, {String? threadId}) {
    return _run(
      kind: GitActionKind.undoCommit,
      method: 'git/undoCommit',
      rpcParams: {'cwd': cwd},
      threadId: threadId,
      cwd: cwd,
      parseResult: (_) {},
    );
  }

  /// Switches [cwd] to [target]. When [carryChanges] is false the current
  /// branch's working changes are stashed (per-branch) and restored on return;
  /// when true they follow you to the target. Refreshes status afterwards.
  Future<void> switchBranch(
    String cwd,
    String target, {
    required bool carryChanges,
    String? threadId,
  }) {
    return _run(
      kind: GitActionKind.checkout,
      method: 'git/switchBranch',
      rpcParams: {
        'cwd': cwd,
        'target': target,
        'carryChanges': carryChanges,
      },
      threadId: threadId,
      cwd: cwd,
      parseResult: (_) {},
    );
  }

  /// Pulls commits from the remote for [params] and refreshes status.
  Future<GitPullResult?> pull(GitPullParams params) {
    return _run(
      kind: GitActionKind.pull,
      method: 'git/pull',
      rpcParams: params.toRpcParams(),
      threadId: params.threadId,
      cwd: params.cwd,
      parseResult: GitPullResult.fromJson,
    );
  }

  /// Checks out an existing branch in [params]'s workspace; refreshes status.
  Future<void> checkout(GitCheckoutParams params) {
    return _run(
      kind: GitActionKind.checkout,
      method: 'git/checkout',
      rpcParams: params.toRpcParams(),
      threadId: params.threadId,
      cwd: params.cwd,
      parseResult: (_) {},
    );
  }

  /// Creates a new branch in [params]'s workspace and refreshes status.
  Future<GitBranchResult?> createBranch(GitBranchParams params) {
    return _run(
      kind: GitActionKind.createBranch,
      method: 'git/createBranch',
      rpcParams: params.toRpcParams(),
      threadId: params.threadId,
      cwd: params.cwd,
      parseResult: GitBranchResult.fromJson,
    );
  }

  /// Creates a new worktree (branch + checkout directory) for [params].
  Future<GitWorktreeResult?> createWorktree(GitWorktreeParams params) {
    return _run(
      kind: GitActionKind.createWorktree,
      method: 'git/createWorktree',
      rpcParams: params.toRpcParams(),
      threadId: params.threadId,
      cwd: params.cwd,
      parseResult: GitWorktreeResult.fromJson,
    );
  }

  /// Reverts [commit] (e.g. `HEAD`) in [cwd] — creates a new commit that undoes
  /// it, preserving history (unlike [undoCommit]'s soft reset). Refreshes
  /// status afterwards.
  Future<void> revert(String cwd, String commit, {String? threadId}) {
    return _run(
      kind: GitActionKind.revert,
      method: 'git/revert',
      rpcParams: {'cwd': cwd, 'commit': commit},
      threadId: threadId,
      cwd: cwd,
      parseResult: (_) {},
    );
  }

  /// Deletes a local [branch] in [cwd]. With [force] false git refuses a branch
  /// that isn't fully merged (surfaced as an error — retry with [force] true
  /// after the user confirms). Refreshes status.
  Future<void> deleteBranch(
    String cwd,
    String branch, {
    bool force = false,
    String? threadId,
  }) {
    return _run(
      kind: GitActionKind.deleteBranch,
      method: 'git/deleteBranch',
      rpcParams: {'cwd': cwd, 'branch': branch, 'force': force},
      threadId: threadId,
      cwd: cwd,
      parseResult: (_) {},
    );
  }

  /// Removes the worktree at [path] (relative to [cwd]'s repo). With [force]
  /// false git refuses a worktree with uncommitted changes (surfaced — retry
  /// with [force] true after the user confirms). Refreshes status.
  Future<void> removeWorktree(
    String cwd,
    String path, {
    bool force = false,
    String? threadId,
  }) {
    return _run(
      kind: GitActionKind.removeWorktree,
      method: 'git/removeWorktree',
      rpcParams: {'cwd': cwd, 'path': path, 'force': force},
      threadId: threadId,
      cwd: cwd,
      parseResult: (_) {},
    );
  }

  /// Fetches the repository's current/local/remote branches.
  Future<GitBranchList> branches(String cwd) async {
    final response = await _sendRequest('git/branches', {'cwd': cwd});
    final result = response.result;
    if (result is! Map) return const GitBranchList();
    return GitBranchList.fromJson(result.cast<String, dynamic>());
  }

  /// Releases resources.
  Future<void> dispose() async {
    await _eventsSub.cancel();
    await _repoState.close();
    await _activeAction.close();
    await _isLoading.close();
  }

  Future<T?> _run<T>({
    required GitActionKind kind,
    required String method,
    required Map<String, dynamic> rpcParams,
    required String? threadId,
    required String cwd,
    required T Function(Map<String, dynamic>) parseResult,
  }) async {
    final startedAt = DateTime.now();
    _activeAction.add(GitActionProgress(kind: kind));
    try {
      final response = await _sendRequest(method, rpcParams);
      final result = response.result;
      final map = result is Map ? result.cast<String, dynamic>() : null;
      final parsed = map == null ? null : parseResult(map);
      _activeAction.add(null);
      await _record(
        kind: kind,
        threadId: threadId,
        rpcParams: rpcParams,
        result: map,
        error: null,
        startedAt: startedAt,
      );
      await refreshStatus(cwd);
      return parsed;
    } catch (error) {
      final current = _activeAction.value;
      _activeAction
          .add(current?.withError('$error') ?? GitActionProgress(kind: kind));
      await _record(
        kind: kind,
        threadId: threadId,
        rpcParams: rpcParams,
        result: null,
        error: '$error',
        startedAt: startedAt,
      );
      rethrow;
    }
  }

  void _applyEvent(DomainEvent event) {
    if (event is! GitProgressEvent) return;
    final current = _activeAction.value;
    if (current == null) return;
    _activeAction.add(current.withPhase(event.phase, event.status));
  }

  Future<void> _record({
    required GitActionKind kind,
    required String? threadId,
    required Map<String, dynamic> rpcParams,
    required Map<String, dynamic>? result,
    required String? error,
    required DateTime startedAt,
  }) async {
    final log = _actionLog;
    if (log == null || threadId == null) return;
    await log.record(
      GitActionLogEntry(
        id: _uuid.v4(),
        threadId: threadId,
        kind: kind,
        succeeded: error == null,
        paramsJson: jsonEncode(rpcParams),
        resultJson: result == null ? null : jsonEncode(result),
        errorMessage: error,
        startedAt: startedAt,
        completedAt: DateTime.now(),
      ),
    );
  }
}
