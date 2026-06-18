import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_diff_view.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen Material 3 source-control surface for a thread's workspace.
///
/// Lists git-detected changed files as collapsible cards (expanded by default)
/// with each file's per-line diff, a green/red counter, and a selection
/// checkbox that controls what a commit includes and what *Discard selected*
/// acts on. The persistent bottom bar holds the commit composer (title +
/// optional description + optional Co-author) and the Commit/Push actions; the
/// app-bar overflow holds Push, Create PR and the destructive *Discard all*.
///
/// Replaces the old `GitActionsSheet` bottom sheet. Pass the active thread's
/// workspace [cwd]; the screen reads `gitRepoStateProvider` (fed by
/// `git/status`) and runs real stage/commit/push/discard/PR operations.
class GitScreen extends ConsumerStatefulWidget {
  /// Creates a [GitScreen].
  const GitScreen({this.cwd, this.threadId, super.key});

  /// Workspace directory the git actions run in; null when unknown.
  final String? cwd;

  /// Owning thread, used to record and read action history.
  final String? threadId;

  /// Pushes the screen onto the navigator.
  static Future<void> push(
    BuildContext context, {
    String? cwd,
    String? threadId,
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => GitScreen(cwd: cwd, threadId: threadId),
      ),
    );
  }

  @override
  ConsumerState<GitScreen> createState() => _GitScreenState();
}

class _GitScreenState extends ConsumerState<GitScreen> {
  /// Paths the user explicitly *unchecked* (everything else is selected — new
  /// files default to included without any seeding).
  final Set<String> _deselected = {};

  /// Paths the user has expanded. Files are collapsed by default so entering
  /// the screen stays fast — a file's diff is only fetched when it's opened.
  final Set<String> _expanded = {};

  /// Per-file diff futures, cached until a mutating action invalidates them.
  final Map<String, Future<GitFileDiff>> _diffs = {};

  final TextEditingController _title = TextEditingController();
  final TextEditingController _description = TextEditingController();
  final TextEditingController _coAuthor = TextEditingController();
  bool _showDetails = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final cwd = widget.cwd;
    if (cwd != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(gitActionManagerProvider).refreshStatus(cwd);
      });
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _coAuthor.dispose();
    super.dispose();
  }

  bool _isSelected(String path) => !_deselected.contains(path);

  bool _isExpanded(String path) => _expanded.contains(path);

  List<String> _selectedPaths(List<GitChangedFile> files) =>
      files.where((f) => _isSelected(f.path)).map((f) => f.path).toList();

  Future<GitFileDiff> _diffFor(String cwd, String path) {
    return _diffs.putIfAbsent(
      path,
      () => ref.read(gitActionManagerProvider).fileDiff(cwd, path),
    );
  }

  /// Drops cached diffs and forces a fresh status read after a mutation.
  Future<void> _refresh(String cwd) async {
    _diffs.clear();
    await ref.read(gitActionManagerProvider).refreshStatus(cwd);
    if (mounted) setState(() {});
  }

  // --- Actions -------------------------------------------------------------

  Future<void> _commit(GitRepoState state) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    final title = _title.text.trim();
    if (title.isEmpty) {
      _toast(l10n.gitCommitTitleRequired);
      return;
    }
    final selected = _selectedPaths(state.changedFiles);
    if (state.changedFiles.isNotEmpty && selected.isEmpty) {
      _toast(l10n.gitSelectFilesFirst);
      return;
    }
    final message = _composeMessage(title);
    // Empty `paths` means "stage everything"; when the user kept every file
    // selected we send no paths so renames/deletions are handled by `add -A`.
    final everything = selected.length == state.changedFiles.length;
    await _guard(
      () async {
        await ref.read(gitActionManagerProvider).commit(
              GitCommitParams(
                cwd: cwd,
                message: message,
                paths: everything ? const [] : selected,
                threadId: widget.threadId,
              ),
            );
        _title.clear();
        _description.clear();
      },
      l10n.gitCommitSuccess,
      cwd,
    );
  }

  String _composeMessage(String title) {
    final buffer = StringBuffer(title);
    final description = _description.text.trim();
    if (description.isNotEmpty) {
      buffer
        ..write('\n\n')
        ..write(description);
    }
    final coAuthor = _coAuthor.text.trim();
    if (coAuthor.isNotEmpty) {
      buffer
        ..write('\n\n')
        ..write('Co-authored-by: $coAuthor');
    }
    return buffer.toString();
  }

  Future<void> _undoCommit(GitRepoState state) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.undo_rounded),
        title: Text(l10n.gitUndoCommitConfirmTitle),
        content: Text(l10n.gitUndoCommitConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.gitCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.gitUndoCommit),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _guard(
      () => ref
          .read(gitActionManagerProvider)
          .undoCommit(cwd, threadId: widget.threadId),
      l10n.gitUndoCommitSuccess,
      cwd,
    );
  }

  /// Reverts the last commit (creates a new commit that undoes `HEAD`),
  /// preserving history — distinct from the soft-reset [_undoCommit].
  Future<void> _revert(GitRepoState state) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.history_rounded),
        title: Text(l10n.gitRevertConfirmTitle),
        content: Text(l10n.gitRevertConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.gitCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.gitRevertLast),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _guard(
      () => ref
          .read(gitActionManagerProvider)
          .revert(cwd, 'HEAD', threadId: widget.threadId),
      l10n.gitRevertSuccess,
      cwd,
    );
  }

  /// Removes the worktree backing this thread (decommissions its workspace).
  /// Tries a safe removal first; on a dirty worktree the bridge refuses, so we
  /// offer an explicit forced removal. On success the screen closes (the cwd is
  /// gone) and the conversation's composer disables (vanished-cwd detection).
  Future<void> _removeWorktree(String worktreePath) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.folder_delete_outlined),
        title: Text(l10n.gitRemoveWorktreeConfirmTitle),
        content: Text(l10n.gitRemoveWorktreeConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.gitCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.gitRemoveWorktree),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final manager = ref.read(gitActionManagerProvider);
    try {
      await manager.removeWorktree(
        cwd,
        worktreePath,
        threadId: widget.threadId,
      );
      if (mounted) Navigator.of(context).pop();
      return;
    } on Object {
      if (!mounted) return;
      // The worktree has uncommitted/untracked changes → offer a forced removal.
      final force = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          icon: const Icon(Icons.warning_amber_rounded),
          title: Text(l10n.gitRemoveWorktreeForceTitle),
          content: Text(l10n.gitRemoveWorktreeForceBody),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l10n.gitCancel),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
              ),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(l10n.gitForceRemove),
            ),
          ],
        ),
      );
      if (force != true || !mounted) return;
      try {
        await manager.removeWorktree(
          cwd,
          worktreePath,
          force: true,
          threadId: widget.threadId,
        );
        if (mounted) Navigator.of(context).pop();
      } on Object catch (error) {
        if (!mounted) return;
        ScaffoldMessenger.of(context)
          ..clearSnackBars()
          ..showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Future<void> _push(GitRepoState state) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    if (ref.read(confirmBeforePushProvider)) {
      final ok = await _confirm(
        title: l10n.gitPushConfirmTitle,
        body: l10n.gitPushConfirmBody,
        action: l10n.gitPushButton,
      );
      if (ok != true || !mounted) return;
    }
    await _guard(
      () => ref.read(gitActionManagerProvider).push(
            GitPushParams(
              cwd: cwd,
              branch: state.branch,
              threadId: widget.threadId,
            ),
          ),
      l10n.gitPushSuccess,
      cwd,
    );
  }

  /// A non-destructive confirmation dialog (Cancel / [action]).
  Future<bool?> _confirm({
    required String title,
    required String body,
    required String action,
  }) {
    return showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(AppLocalizations.of(context).gitCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(action),
          ),
        ],
      ),
    );
  }

  Future<void> _switchBranch(GitRepoState state) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    GitBranchList branches;
    setState(() => _busy = true);
    try {
      branches = await ref.read(gitActionManagerProvider).branches(cwd);
    } on Object {
      branches = GitBranchList(current: state.branch);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    final target = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (_) => _BranchPicker(
        branches: branches,
        current: state.branch,
        onDeleteBranch: (branch) => _deleteBranch(cwd, branch),
      ),
    );
    if (target == null || target == state.branch || !mounted) return;
    // With uncommitted changes, ask whether to carry them along or leave them
    // safely on the current branch (per-branch auto-stash on the bridge).
    var carry = false;
    if (state.isDirty) {
      final choice = await _carryOrLeave(state.branch, target);
      if (choice == null || !mounted) return;
      carry = choice;
    }
    await _guard(
      () => ref.read(gitActionManagerProvider).switchBranch(
            cwd,
            target,
            carryChanges: carry,
            threadId: widget.threadId,
          ),
      l10n.gitSwitchSuccess(target),
      cwd,
    );
  }

  /// Deletes a local [branch] (invoked from the branch picker). Tries a safe
  /// delete first; if git refuses (the branch isn't fully merged) the user is
  /// offered an explicit forced delete. Returns true when the branch was
  /// deleted, so the picker can drop it from the list.
  Future<bool> _deleteBranch(String cwd, String branch) async {
    final l10n = AppLocalizations.of(context);
    final manager = ref.read(gitActionManagerProvider);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.delete_outline_rounded),
        title: Text(l10n.gitDeleteBranchConfirmTitle),
        content: Text(l10n.gitDeleteBranchConfirmBody(branch)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.gitCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.gitDeleteBranch),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return false;
    try {
      await manager.deleteBranch(cwd, branch, threadId: widget.threadId);
      return true;
    } on Object {
      if (!mounted) return false;
      // git refused — the branch isn't fully merged. Offer a forced delete.
      final force = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          icon: const Icon(Icons.warning_amber_rounded),
          title: Text(l10n.gitDeleteBranchForceTitle),
          content: Text(l10n.gitDeleteBranchForceBody(branch)),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l10n.gitCancel),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
              ),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(l10n.gitForceDelete),
            ),
          ],
        ),
      );
      if (force != true || !mounted) return false;
      try {
        await manager.deleteBranch(
          cwd,
          branch,
          force: true,
          threadId: widget.threadId,
        );
        return true;
      } on Object catch (error) {
        if (!mounted) return false;
        ScaffoldMessenger.of(context)
          ..clearSnackBars()
          ..showSnackBar(SnackBar(content: Text('$error')));
        return false;
      }
    }
  }

  /// Returns true to carry changes, false to leave them, null to cancel.
  Future<bool?> _carryOrLeave(String current, String target) {
    final l10n = AppLocalizations.of(context);
    return showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.alt_route_rounded),
        title: Text(l10n.gitSwitchCarryTitle),
        content: Text(l10n.gitSwitchCarryBody(target, current)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.gitCancel),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.gitSwitchLeave),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.gitSwitchCarry),
          ),
        ],
      ),
    );
  }

  Future<void> _discard(GitRepoState state, {required bool all}) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    final paths = all
        ? state.changedFiles.map((f) => f.path).toList()
        : _selectedPaths(state.changedFiles);
    if (paths.isEmpty) {
      _toast(l10n.gitSelectFilesFirst);
      return;
    }
    final confirmed = await _confirmDiscard(paths.length);
    if (confirmed != true || !mounted) return;
    await _guard(
      () => ref.read(gitActionManagerProvider).discard(
            GitDiscardParams(
              cwd: cwd,
              paths: paths,
              threadId: widget.threadId,
            ),
          ),
      l10n.gitDiscardSuccess,
      cwd,
    );
  }

  Future<bool?> _confirmDiscard(int count) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.warning_amber_rounded),
        title: Text(l10n.gitDiscardConfirmTitle),
        content: Text(l10n.gitDiscardConfirmBody(count)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.gitCancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: colors.error),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.gitDiscard),
          ),
        ],
      ),
    );
  }

  Future<void> _createPr(GitRepoState state) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    // Detect local + remote branches up front so the dialog can offer real
    // source/target choices (best-effort: fall back to the current branch).
    GitBranchList branches;
    setState(() => _busy = true);
    try {
      branches = await ref.read(gitActionManagerProvider).branches(cwd);
    } on Object {
      branches = GitBranchList(current: state.branch);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    final seed = _title.text.trim();
    final result = await showDialog<_PrInput>(
      context: context,
      useSafeArea: false,
      builder: (_) => _PrDialog(
        initialTitle: seed,
        branches: branches,
        fallbackBranch: state.branch,
      ),
    );
    if (result == null || !mounted) return;
    if (ref.read(confirmBeforePrProvider)) {
      final ok = await _confirm(
        title: l10n.gitPrConfirmTitle,
        body: l10n.gitPrConfirmBody,
        action: l10n.gitPrCreate,
      );
      if (ok != true || !mounted) return;
    }
    // Run the PR explicitly (not via _guard) so we only report success when the
    // bridge actually returns a pull-request URL — the bridge validates that
    // there are commits to compare and that `gh` returned a real PR, throwing
    // otherwise. A failure must inform the user, never a false success.
    setState(() => _busy = true);
    GitPrResult? pr;
    var failed = false;
    try {
      pr = await ref.read(gitActionManagerProvider).createPr(
            GitPrParams(
              cwd: cwd,
              title: result.title,
              body: result.body,
              base: result.base,
              head: result.head,
              threadId: widget.threadId,
            ),
          );
    } on Object {
      failed = true;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    await _refresh(cwd);
    if (!mounted) return;
    final url = pr?.url ?? '';
    if (failed || url.isEmpty) {
      _toast(l10n.gitPrFailed);
      return;
    }
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text('${l10n.gitPrSuccess} · $url'),
          action: SnackBarAction(
            label: l10n.gitPrViewAction,
            onPressed: () => Clipboard.setData(ClipboardData(text: url)),
          ),
        ),
      );
  }

  /// Pulls from the remote for the active workspace.
  Future<void> _pull(GitRepoState state) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    await _guard(
      () => ref.read(gitActionManagerProvider).pull(
            GitPullParams(cwd: cwd, threadId: widget.threadId),
          ),
      l10n.gitPullSuccess,
      cwd,
    );
  }

  /// Creates a new branch and checks out to it (create & switch).
  Future<void> _newBranch(GitRepoState state) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    final name = await _promptText(
      title: l10n.gitNewBranch,
      hint: l10n.gitNewBranchHint,
      action: l10n.gitNewBranch,
    );
    final branch = name?.trim() ?? '';
    if (branch.isEmpty || !mounted) return;
    await _guard(
      () async {
        final manager = ref.read(gitActionManagerProvider);
        await manager.createBranch(
          GitBranchParams(cwd: cwd, name: branch, threadId: widget.threadId),
        );
        await manager.checkout(
          GitCheckoutParams(
            cwd: cwd,
            branch: branch,
            threadId: widget.threadId,
          ),
        );
      },
      l10n.gitNewBranchSuccess,
      cwd,
    );
  }

  /// A single-field text prompt (branch name).
  Future<String?> _promptText({
    required String title,
    required String hint,
    required String action,
  }) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(labelText: hint),
          onSubmitted: (value) => Navigator.pop(dialogContext, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(AppLocalizations.of(dialogContext).gitCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text),
            child: Text(action),
          ),
        ],
      ),
    );
  }

  Future<void> _guard(
    Future<void> Function() action,
    String success,
    String cwd,
  ) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) _toast(success);
      await _refresh(cwd);
    } on Object {
      if (mounted) _toast(AppLocalizations.of(context).gitActionFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  // --- Build ---------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final state = ref.watch(gitRepoStateProvider).value;
    final files = state?.changedFiles ?? const <GitChangedFile>[];
    final allExpanded =
        files.isNotEmpty && files.every((f) => _expanded.contains(f.path));
    // Worktree-backed threads can decommission their worktree from here.
    final threadId = widget.threadId;
    final worktreePath = threadId == null
        ? null
        : ref.watch(threadByIdProvider(threadId))?.worktreePath;

    final colors = Theme.of(context).colorScheme;
    final topInset = NeTopBar.preferredHeight(context);
    return Scaffold(
      body: Stack(
        // StackFit.expand keeps the bar at the full row width — the
        // default loose fit sizes the stack to its non-Positioned child
        // (the file list / commit composer column) which can report a
        // narrow intrinsic width and starve the NeTopBar's actions row
        // of horizontal space, triggering a RenderFlex overflow in the
        // bar's Row.
        fit: StackFit.expand,
        children: [
          Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: () => FocusScope.of(context).unfocus(),
                      child: CustomScrollView(
                        // Bouncing + always-scrollable matches `NeScaffold`
                        // and the file browser so the screen feels native
                        // on iOS and the user can drag-to-refresh even when
                        // the content fits the viewport.
                        physics: const BouncingScrollPhysics(
                          parent: AlwaysScrollableScrollPhysics(),
                        ),
                        slivers: [
                          // Spacer so first content clears the overlaid bar.
                          SliverToBoxAdapter(
                            child: SizedBox(height: topInset),
                          ),
                          if (state == null)
                            SliverFillRemaining(
                              hasScrollBody: false,
                              child:
                                  _NoRepository(connecting: widget.cwd != null),
                            )
                          else ...[
                            SliverToBoxAdapter(
                              child: _BranchSummary(state: state),
                            ),
                            if (files.isEmpty)
                              const SliverToBoxAdapter(child: _CleanState())
                            else ...[
                              SliverToBoxAdapter(
                                child: _SelectionBar(
                                  total: files.length,
                                  selected: _selectedPaths(files).length,
                                  onSelectAll: () =>
                                      setState(_deselected.clear),
                                  onDeselectAll: () => setState(
                                    () => _deselected
                                        .addAll(files.map((f) => f.path)),
                                  ),
                                  onDiscardSelected: _busy
                                      ? null
                                      : () => _discard(state, all: false),
                                ),
                              ),
                              SliverList.builder(
                                itemCount: files.length,
                                itemBuilder: (context, index) {
                                  final file = files[index];
                                  return _FileCard(
                                    file: file,
                                    selected: _isSelected(file.path),
                                    expanded: _isExpanded(file.path),
                                    onSelectedChanged: (value) => setState(() {
                                      if (value) {
                                        _deselected.remove(file.path);
                                      } else {
                                        _deselected.add(file.path);
                                      }
                                    }),
                                    onExpandedChanged: (value) => setState(() {
                                      if (value) {
                                        _expanded.add(file.path);
                                      } else {
                                        _expanded.remove(file.path);
                                      }
                                    }),
                                    onDiscard: _busy
                                        ? null
                                        : () => _discardOne(state, file.path),
                                    diff: widget.cwd == null ||
                                            !_isExpanded(file.path)
                                        ? null
                                        : _diffFor(widget.cwd!, file.path),
                                  );
                                },
                              ),
                              const SliverToBoxAdapter(
                                child: SizedBox(height: UxnanSpacing.lg),
                              ),
                            ],
                          ],
                        ],
                      ),
                    ),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: IgnorePointer(
                        child: Container(
                          height: UxnanSpacing.xl,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                colors.surface.withValues(alpha: 0),
                                colors.surface,
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              if (state != null)
                _CommitBar(
                  state: state,
                  title: _title,
                  description: _description,
                  coAuthor: _coAuthor,
                  showDetails: _showDetails,
                  busy: _busy,
                  onToggleDetails: () =>
                      setState(() => _showDetails = !_showDetails),
                  onCommit: () => _commit(state),
                  onPush: () => _push(state),
                  onUndoCommit: () => _undoCommit(state),
                ),
            ],
          ),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: NeTopBar(
              leading: IconSurface(
                icon: Icons.arrow_back_rounded,
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => Navigator.of(context).maybePop(),
              ),
              title: Text(
                l10n.gitActionsTitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontSize: 20),
              ),
              actions: [
                // Pull only surfaces when the remote is ahead, badged with the
                // number of commits to pull.
                if (state != null && state.behind > 0)
                  Badge.count(
                    count: state.behind,
                    child: IconSurface(
                      icon: Icons.download_rounded,
                      tooltip: '${l10n.gitPull} (${state.behind})',
                      onPressed: _busy ? null : () => _pull(state),
                    ),
                  ),
                IconSurface(
                  icon: Icons.refresh_rounded,
                  tooltip: l10n.gitRefresh,
                  onPressed: _busy || widget.cwd == null
                      ? null
                      : () => _refresh(widget.cwd!),
                ),
                if (files.isNotEmpty)
                  IconSurface(
                    icon: allExpanded
                        ? Icons.unfold_less_rounded
                        : Icons.unfold_more_rounded,
                    tooltip:
                        allExpanded ? l10n.gitCollapseAll : l10n.gitExpandAll,
                    onPressed: () => setState(() {
                      if (allExpanded) {
                        _expanded.clear();
                      } else {
                        _expanded.addAll(files.map((f) => f.path));
                      }
                    }),
                  ),
                if (state != null)
                  _OverflowMenu(
                    state: state,
                    busy: _busy,
                    onSwitchBranch: () => _switchBranch(state),
                    onNewBranch: () => _newBranch(state),
                    onRevert: () => _revert(state),
                    onCreatePr: () => _createPr(state),
                    onDiscardAll: () => _discard(state, all: true),
                    onRemoveWorktree: worktreePath == null
                        ? null
                        : () => _removeWorktree(worktreePath),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _discardOne(GitRepoState state, String path) async {
    final cwd = widget.cwd;
    final l10n = AppLocalizations.of(context);
    if (cwd == null) return;
    final confirmed = await _confirmDiscard(1);
    if (confirmed != true || !mounted) return;
    await _guard(
      () => ref.read(gitActionManagerProvider).discard(
            GitDiscardParams(
              cwd: cwd,
              paths: [path],
              threadId: widget.threadId,
            ),
          ),
      l10n.gitDiscardSuccess,
      cwd,
    );
  }
}

/// App-bar overflow with the low-frequency branch/PR actions: switch branch,
/// new branch, create PR and the destructive discard-all. Push and undo-commit
/// live on the commit composer (its buttons morph by state); pull is a badged
/// app-bar action.
class _OverflowMenu extends StatelessWidget {
  const _OverflowMenu({
    required this.state,
    required this.busy,
    required this.onSwitchBranch,
    required this.onNewBranch,
    required this.onCreatePr,
    required this.onRevert,
    required this.onDiscardAll,
    this.onRemoveWorktree,
  });

  final GitRepoState state;
  final bool busy;
  final VoidCallback onSwitchBranch;
  final VoidCallback onNewBranch;
  final VoidCallback onCreatePr;
  final VoidCallback onRevert;
  final VoidCallback onDiscardAll;

  /// Removes the worktree backing this thread; null when the thread isn't
  /// worktree-backed (so the item is hidden).
  final VoidCallback? onRemoveWorktree;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return IconSurfaceMenu<void>(
      tooltip: l10n.threadsMore,
      icon: Icons.more_vert_rounded,
      constraints: const BoxConstraints(minWidth: 220),
      itemBuilder: (_) => [
        PopupMenuItem(
          enabled: !busy,
          onTap: onSwitchBranch,
          child: _MenuRow(
            icon: Icons.swap_horiz_rounded,
            label: l10n.gitSwitchBranch,
          ),
        ),
        PopupMenuItem(
          enabled: !busy,
          onTap: onNewBranch,
          child: _MenuRow(
            icon: Icons.add_rounded,
            label: l10n.gitNewBranch,
          ),
        ),
        PopupMenuItem(
          enabled: !busy,
          onTap: onCreatePr,
          child: _MenuRow(
            icon: Icons.merge_rounded,
            label: l10n.gitCreatePr,
          ),
        ),
        PopupMenuItem(
          enabled: !busy,
          onTap: onRevert,
          child: _MenuRow(
            icon: Icons.history_rounded,
            label: l10n.gitRevertLast,
          ),
        ),
        if (onRemoveWorktree != null)
          PopupMenuItem(
            enabled: !busy,
            onTap: onRemoveWorktree,
            child: _MenuRow(
              icon: Icons.folder_delete_outlined,
              label: l10n.gitRemoveWorktree,
              color: colors.error,
            ),
          ),
        if (state.isDirty)
          PopupMenuItem(
            enabled: !busy,
            onTap: onDiscardAll,
            child: _MenuRow(
              icon: Icons.delete_outline_rounded,
              label: l10n.gitDiscardAll,
              color: colors.error,
            ),
          ),
      ],
    );
  }
}

class _MenuRow extends StatelessWidget {
  const _MenuRow({required this.icon, required this.label, this.color});
  final IconData icon;
  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 20, color: color),
        const SizedBox(width: UxnanSpacing.md),
        Text(label, style: TextStyle(color: color)),
      ],
    );
  }
}

/// Branch, upstream, ahead/behind and aggregate diff counters. A neutral NE
/// surface (no M3 `Card`): rounded corners + `surfaceContainerHigh` background
/// + an outline subtle enough to disappear on dark mode.
class _BranchSummary extends StatelessWidget {
  const _BranchSummary({required this.state});
  final GitRepoState state;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final totals = state.diffTotals;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        0,
        UxnanSpacing.lg,
        UxnanSpacing.sm,
      ),
      child: NeSurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.account_tree_outlined,
                  size: 18,
                  color: colors.onSurfaceVariant,
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    state.branch,
                    style: textTheme.titleMedium,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (state.ahead > 0)
                  _Counter(
                    icon: Icons.arrow_upward_rounded,
                    value: state.ahead,
                  ),
                if (state.behind > 0) ...[
                  const SizedBox(width: UxnanSpacing.sm),
                  _Counter(
                    icon: Icons.arrow_downward_rounded,
                    value: state.behind,
                  ),
                ],
              ],
            ),
            if (state.upstream != null) ...[
              const SizedBox(height: UxnanSpacing.xs),
              Text(
                state.upstream!,
                style: UxnanTypography.codeSmall.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: UxnanSpacing.sm),
            Row(
              children: [
                Icon(
                  state.isDirty
                      ? Icons.pending_outlined
                      : Icons.check_circle_outline,
                  size: 15,
                  color:
                      state.isDirty ? UxnanColors.warning : UxnanColors.success,
                ),
                const SizedBox(width: UxnanSpacing.xs),
                Text(
                  state.isDirty ? l10n.gitDirtyState : l10n.gitCleanState,
                  style: textTheme.bodySmall,
                ),
                if (state.isDirty && !totals.isEmpty) ...[
                  const SizedBox(width: UxnanSpacing.sm),
                  Text(
                    '+${totals.additions} −${totals.deletions} · '
                    '${totals.changedFileCount}',
                    style: UxnanTypography.codeSmall.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Counter extends StatelessWidget {
  const _Counter({required this.icon, required this.value});
  final IconData icon;
  final int value;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: colors.onSurfaceVariant),
        Text(
          '$value',
          style: UxnanTypography.codeSmall.copyWith(
            color: colors.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// Select-all control, the selected/total count and *Discard selected*. Uses
/// an [_NeCheckbox] (a circular IconSurface) instead of the M3 Checkbox so
/// the gesture + scale spring match the rest of the screen.
class _SelectionBar extends StatelessWidget {
  const _SelectionBar({
    required this.total,
    required this.selected,
    required this.onSelectAll,
    required this.onDeselectAll,
    required this.onDiscardSelected,
  });

  final int total;
  final int selected;
  final VoidCallback onSelectAll;
  final VoidCallback onDeselectAll;
  final VoidCallback? onDiscardSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final all = selected == total;
    final none = selected == 0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.sm,
        UxnanSpacing.xs,
      ),
      child: Row(
        children: [
          _NeCheckbox(
            // `null` ⇒ indeterminate (some-but-not-all selected) — matches the
            // previous `Checkbox(tristate: true)` semantics.
            value: none ? false : (all ? true : null),
            onChanged: (_) => all ? onDeselectAll() : onSelectAll(),
          ),
          const SizedBox(width: UxnanSpacing.xs),
          Expanded(
            child: Text(
              l10n.gitSelectedCount(selected, total),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          // The destructive "Discard selected" action as a TextButton with an
          // error-tinted glyph (kept; it sits outside the app-bar flow and is
          // contextual to the row).
          TextButton.icon(
            onPressed: none ? null : onDiscardSelected,
            icon: Icon(
              Icons.delete_outline_rounded,
              size: 18,
              color: none ? null : colors.error,
            ),
            label: Text(
              l10n.gitDiscardSelected,
              style: TextStyle(color: none ? null : colors.error),
            ),
          ),
        ],
      ),
    );
  }
}

/// A collapsible card for one changed file: selection glyph, status icon,
/// name/path title, green/red counter, and the per-line diff body. Uses the
/// app's [_NeSurface] chrome and an [_NeCheckbox] so the gesture ripple is
/// the round NE shape (not the rectangular M3 default).
class _FileCard extends StatelessWidget {
  const _FileCard({
    required this.file,
    required this.selected,
    required this.expanded,
    required this.onSelectedChanged,
    required this.onExpandedChanged,
    required this.onDiscard,
    required this.diff,
  });

  final GitChangedFile file;
  final bool selected;
  final bool expanded;
  final ValueChanged<bool> onSelectedChanged;
  final ValueChanged<bool> onExpandedChanged;
  final VoidCallback? onDiscard;
  final Future<GitFileDiff>? diff;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final (icon, color, label) = _statusVisuals(file.status, l10n);
    final segments = file.path.split('/');
    final name = segments.isEmpty ? file.path : segments.last;
    final dir = segments.length > 1
        ? segments.sublist(0, segments.length - 1).join('/')
        : null;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        UxnanSpacing.xs,
      ),
      child: NeSurface(
        outlined: true,
        child: Column(
          children: [
            // Tappable row: the *whole* card toggles expansion so a tap on the
            // path or counter still expands it (only the selection glyph and
            // the discard action consume their own tap).
            _ExpandableRow(
              onTap: () => onExpandedChanged(!expanded),
              child: Row(
                children: [
                  _NeCheckbox(
                    value: selected,
                    onChanged: (v) => onSelectedChanged(v ?? false),
                  ),
                  Icon(icon, size: 18, color: color, semanticLabel: label),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: textTheme.titleSmall?.copyWith(
                            // The file's name also takes the git-status colour
                            // so the row reads at a glance, even before reading
                            // the icon. Matches the file browser's tile.
                            color: color,
                            fontWeight: FontWeight.w500,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (dir != null)
                          Text(
                            dir,
                            style: UxnanTypography.codeSmall.copyWith(
                              color: colors.onSurfaceVariant,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  if (file.additions > 0)
                    Text(
                      '+${file.additions}',
                      style: UxnanTypography.codeSmall.copyWith(
                        color: UxnanColors.gitAdded,
                      ),
                    ),
                  if (file.deletions > 0) ...[
                    const SizedBox(width: UxnanSpacing.xs),
                    Text(
                      '−${file.deletions}',
                      style: UxnanTypography.codeSmall.copyWith(
                        color: UxnanColors.gitDeleted,
                      ),
                    ),
                  ],
                  IconSurface(
                    icon: Icons.undo_rounded,
                    tooltip: l10n.gitDiscard,
                    onPressed: onDiscard,
                  ),
                  IconSurface(
                    icon: expanded
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
                    tooltip: l10n.gitActionsTitle,
                    onPressed: () => onExpandedChanged(!expanded),
                  ),
                ],
              ),
            ),
            if (expanded)
              Align(
                alignment: Alignment.centerLeft,
                child: GitDiffView(future: diff),
              ),
          ],
        ),
      ),
    );
  }
}

/// The persistent bottom composer: commit title, optional details, and the
/// Commit / Push action row. The morphing pill (stadium → rounded rect) is a
/// signature element from the conversation composer — re-used here so both
/// input surfaces share the same shape language.
class _CommitBar extends StatelessWidget {
  const _CommitBar({
    required this.state,
    required this.title,
    required this.description,
    required this.coAuthor,
    required this.showDetails,
    required this.busy,
    required this.onToggleDetails,
    required this.onCommit,
    required this.onPush,
    required this.onUndoCommit,
  });

  final GitRepoState state;
  final TextEditingController title;
  final TextEditingController description;
  final TextEditingController coAuthor;
  final bool showDetails;
  final bool busy;
  final VoidCallback onToggleDetails;
  final VoidCallback onCommit;
  final VoidCallback onPush;
  final VoidCallback onUndoCommit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final canCommit = state.isDirty && !busy;
    final hasPush = state.hasUnpushedCommits;
    // Push mode: the tree is clean but commits await push — the two buttons
    // morph from commit/details to push/undo-last-commit.
    final pushMode = !state.isDirty && hasPush;
    final textTheme = Theme.of(context).textTheme;

    // Floating composer matching the conversation pill: a fully-rounded
    // (stadium) pill when collapsed — the title field and the inline actions on
    // one aligned row — that morphs smoothly to a rounded rectangle when the
    // optional description / co-author fields are revealed.
    return SafeArea(
      top: false,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: UxnanSpacing.maxContentWidth,
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.md,
            ),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              decoration: BoxDecoration(
                color: colors.surfaceContainerHighest,
                // Stadium when collapsed, rounded rectangle when expanded.
                borderRadius: BorderRadius.circular(showDetails ? 24 : 100),
              ),
              padding: EdgeInsets.fromLTRB(
                UxnanSpacing.md,
                showDetails ? UxnanSpacing.sm : UxnanSpacing.xs,
                UxnanSpacing.sm,
                showDetails ? UxnanSpacing.sm : UxnanSpacing.xs,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // The aligned top row — the whole pill when collapsed.
                  Row(
                    children: [
                      Expanded(
                        child: _BorderlessField(
                          controller: title,
                          enabled: canCommit,
                          hint: l10n.gitCommitMessageLabel,
                          style: textTheme.titleSmall,
                          textInputAction: TextInputAction.next,
                        ),
                      ),
                      const SizedBox(width: UxnanSpacing.xs),
                      // Secondary: the details toggle while committing; the
                      // undo-last-commit once committed (push mode).
                      if (pushMode)
                        IconSurface(
                          icon: Icons.undo_rounded,
                          tooltip: l10n.gitUndoCommit,
                          onPressed: busy ? null : onUndoCommit,
                        )
                      else
                        IconSurface(
                          icon: showDetails
                              ? Icons.expand_more_rounded
                              : Icons.notes_rounded,
                          tooltip: l10n.gitCommitDescriptionLabel,
                          selected: showDetails,
                          onPressed: canCommit ? onToggleDetails : null,
                        ),
                      const SizedBox(width: UxnanSpacing.xs),
                      // Primary: commit while dirty; push once committed.
                      if (pushMode)
                        _PrimaryActionButton(
                          icon: Icons.arrow_upward_rounded,
                          tooltip: '${l10n.gitPushButton} (${state.ahead})',
                          busy: busy,
                          // Push is badged with the number of commits ahead.
                          badge: state.ahead > 0
                              ? Badge.count(
                                  count: state.ahead,
                                  child: const SizedBox.shrink(),
                                )
                              : null,
                          onPressed: busy ? null : onPush,
                        )
                      else
                        _PrimaryActionButton(
                          icon: Icons.check_rounded,
                          tooltip: l10n.gitCommitButton,
                          busy: busy,
                          onPressed: canCommit ? onCommit : null,
                        ),
                    ],
                  ),
                  // Optional fields slide in below (morphing pill → rectangle).
                  AnimatedSize(
                    duration: const Duration(milliseconds: 220),
                    curve: Curves.easeOutCubic,
                    alignment: Alignment.topCenter,
                    child: showDetails && !pushMode
                        ? Column(
                            children: [
                              const SizedBox(height: UxnanSpacing.xs),
                              Divider(height: 1, color: colors.outlineVariant),
                              _BorderlessField(
                                controller: description,
                                enabled: canCommit,
                                hint: l10n.gitCommitDescriptionHint,
                                minLines: 1,
                                maxLines: 4,
                              ),
                              Divider(height: 1, color: colors.outlineVariant),
                              _BorderlessField(
                                controller: coAuthor,
                                enabled: canCommit,
                                hint: l10n.gitCoAuthorHint,
                              ),
                            ],
                          )
                        : const SizedBox(width: double.infinity),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A borderless, placeholder-only text field used by the commit composer —
/// no outline, natural focus behaviour, matching the conversation composer.
class _BorderlessField extends StatelessWidget {
  const _BorderlessField({
    required this.controller,
    required this.enabled,
    required this.hint,
    this.style,
    this.minLines,
    this.maxLines = 1,
    this.textInputAction,
  });

  final TextEditingController controller;
  final bool enabled;
  final String hint;
  final TextStyle? style;
  final int? minLines;
  final int maxLines;
  final TextInputAction? textInputAction;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return TextField(
      controller: controller,
      enabled: enabled,
      minLines: minLines,
      maxLines: maxLines,
      style: style,
      textInputAction: textInputAction,
      textCapitalization: TextCapitalization.sentences,
      decoration: InputDecoration(
        isDense: true,
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        contentPadding: const EdgeInsets.symmetric(
          vertical: UxnanSpacing.sm,
        ),
        hintText: hint,
        hintStyle: TextStyle(color: colors.onSurfaceVariant),
      ),
    );
  }
}

class _CleanState extends StatelessWidget {
  const _CleanState();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xxl),
      child: Column(
        children: [
          const Icon(
            Icons.check_circle_outline,
            size: 40,
            color: UxnanColors.success,
          ),
          const SizedBox(height: UxnanSpacing.sm),
          Text(l10n.gitCleanState, style: textTheme.titleSmall),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            l10n.gitNothingToCommit,
            style: textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _NoRepository extends StatelessWidget {
  const _NoRepository({required this.connecting});
  final bool connecting;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    if (connecting) {
      return const Center(child: CircularProgressIndicator());
    }
    return Padding(
      padding: const EdgeInsets.all(UxnanSpacing.xl),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.source_outlined,
            size: 40,
            color: colors.onSurfaceVariant,
          ),
          const SizedBox(height: UxnanSpacing.md),
          Text(l10n.gitNoRepository, style: textTheme.titleSmall),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            l10n.gitNoRepositoryBody,
            style: textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

(IconData, Color, String) _statusVisuals(
  GitFileStatus status,
  AppLocalizations l10n,
) {
  return switch (status) {
    GitFileStatus.added => (
        Icons.add_circle_outline,
        UxnanColors.gitAdded,
        l10n.gitStatusAdded,
      ),
    GitFileStatus.modified => (
        Icons.edit_outlined,
        UxnanColors.gitModified,
        l10n.gitStatusModified,
      ),
    GitFileStatus.deleted => (
        Icons.remove_circle_outline,
        UxnanColors.gitDeleted,
        l10n.gitStatusDeleted,
      ),
    GitFileStatus.renamed => (
        Icons.drive_file_rename_outline,
        UxnanColors.gitUntracked,
        l10n.gitStatusRenamed,
      ),
    GitFileStatus.untracked => (
        Icons.fiber_new_outlined,
        UxnanColors.gitUntracked,
        l10n.gitStatusUntracked,
      ),
  };
}

/// Strips a remote prefix from a ref (`origin/main` → `main`).
String _bareBranch(String ref) {
  final slash = ref.indexOf('/');
  return slash == -1 ? ref : ref.substring(slash + 1);
}

/// A bottom-sheet list of branches to switch to (local + bare remotes), with
/// the current branch shown at the top, disabled. Each row is a tap target
/// with a leading glyph + trailing delete (when applicable) — the press
/// feedback matches the rest of the app.
class _BranchPicker extends StatefulWidget {
  const _BranchPicker({
    required this.branches,
    required this.current,
    required this.onDeleteBranch,
  });

  final GitBranchList branches;
  final String current;

  /// Deletes the given branch; returns true when removed (the row then
  /// disappears). The parent owns the confirm + forced-delete flow.
  final Future<bool> Function(String branch) onDeleteBranch;

  @override
  State<_BranchPicker> createState() => _BranchPickerState();
}

class _BranchPickerState extends State<_BranchPicker> {
  late final List<String> _others = _initialOthers();

  /// The branch currently being deleted (shows a spinner on its row).
  String? _deleting;

  List<String> _initialOthers() {
    final options = <String>{
      ...widget.branches.local,
      ...widget.branches.remote.map(_bareBranch),
    }..remove(widget.current);
    return options.toList()..sort();
  }

  bool _isLocal(String branch) => widget.branches.local.contains(branch);

  /// The primary branch is never offered for deletion (you almost always work
  /// on it; deleting it is rarely intended). Covers the common default names.
  static const _protected = {'main', 'master'};

  /// Whether [branch] can be deleted: a local, non-primary branch only (remotes
  /// need `push --delete`; the current branch is already off the list).
  bool _canDelete(String branch) =>
      _isLocal(branch) && !_protected.contains(branch);

  Future<void> _delete(String branch) async {
    setState(() => _deleting = branch);
    final removed = await widget.onDeleteBranch(branch);
    if (!mounted) return;
    setState(() {
      _deleting = null;
      if (removed) _others.remove(branch);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: UxnanSpacing.md),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.sm,
            ),
            child: Text(
              l10n.gitSwitchBranchTitle,
              style: textTheme.titleMedium,
            ),
          ),
          // Current branch — leading check + bodyMedium title. Disabled because
          // switching to the branch you're already on is a no-op.
          _BranchPickerRow(
            leading: Icon(Icons.check_rounded, color: colors.primary),
            title: Text(widget.current),
            subtitle: Text(l10n.gitSwitchBranchCurrent(widget.current)),
            enabled: false,
            onTap: () {},
            trailing: null,
          ),
          if (_others.isNotEmpty)
            Divider(height: 1, color: colors.outlineVariant),
          for (final branch in _others)
            _BranchPickerRow(
              leading: Icon(
                Icons.account_tree_outlined,
                color: colors.onSurfaceVariant,
              ),
              title: Text(branch, overflow: TextOverflow.ellipsis),
              enabled: _deleting == null,
              onTap: _deleting == null
                  ? () => Navigator.of(context).pop(branch)
                  : null,
              trailing: !_canDelete(branch)
                  ? null
                  : _deleting == branch
                      ? const Padding(
                          padding: EdgeInsets.symmetric(
                            horizontal: UxnanSpacing.sm,
                          ),
                          child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : IconSurface(
                          icon: Icons.delete_outline_rounded,
                          tooltip: l10n.gitDeleteBranch,
                          background: colors.surfaceContainerHigh,
                          foreground: colors.error,
                          onPressed:
                              _deleting != null ? null : () => _delete(branch),
                        ),
            ),
        ],
      ),
    );
  }
}

/// A row in [_BranchPicker] with a leading glyph, optional subtitle, and an
/// optional trailing action — replaces the M3 `ListTile` so the entire
/// surface speaks NE.
class _BranchPickerRow extends StatelessWidget {
  const _BranchPickerRow({
    required this.leading,
    required this.title,
    required this.onTap,
    required this.enabled,
    this.subtitle,
    this.trailing,
  });

  final Widget leading;
  final Widget title;
  final Widget? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onTap : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.lg,
            vertical: UxnanSpacing.sm,
          ),
          child: Row(
            children: [
              leading,
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DefaultTextStyle.merge(
                      style: TextStyle(
                        color: enabled
                            ? colors.onSurface
                            : colors.onSurfaceVariant,
                      ),
                      child: title,
                    ),
                    if (subtitle != null)
                      DefaultTextStyle.merge(
                        style: Theme.of(context).textTheme.bodySmall!.copyWith(
                              color: colors.onSurfaceVariant,
                            ),
                        child: subtitle!,
                      ),
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
        ),
      ),
    );
  }
}

/// Result of the PR dialog.
class _PrInput {
  const _PrInput({required this.title, this.body, this.base, this.head});
  final String title;
  final String? body;
  final String? base;
  final String? head;
}

/// Full-screen pull-request composer: title, description, and source (head) /
/// target (base) branch pickers populated from the repo's real local + remote
/// branches. Matches the app's M3 surfaces; the source branch is pushed to the
/// remote when the PR is created (shown as a note).
class _PrDialog extends StatefulWidget {
  const _PrDialog({
    required this.initialTitle,
    required this.branches,
    required this.fallbackBranch,
  });

  final String initialTitle;
  final GitBranchList branches;
  final String fallbackBranch;

  @override
  State<_PrDialog> createState() => _PrDialogState();
}

class _PrDialogState extends State<_PrDialog> {
  late final TextEditingController _title =
      TextEditingController(text: widget.initialTitle);
  final TextEditingController _body = TextEditingController();
  String? _error;
  late String? _head = _headOptions.isEmpty ? null : _headOptions.first;
  late String? _base = _defaultBase;

  /// Local branches are valid PR heads; the current branch leads the list.
  List<String> get _headOptions {
    final current = widget.branches.current.isNotEmpty
        ? widget.branches.current
        : widget.fallbackBranch;
    final locals = <String>{
      if (current.isNotEmpty) current,
      ...widget.branches.local,
    };
    return locals.toList();
  }

  /// Bare branch names that can be a PR base — remote branches (without their
  /// remote prefix) merged with locals, so the user can target either.
  List<String> get _baseOptions {
    final names = <String>{
      ...widget.branches.remote.map(_bareBranch),
      ...widget.branches.local,
    };
    return names.toList();
  }

  String? get _defaultBase {
    final options = _baseOptions;
    if (options.isEmpty) return null;
    for (final preferred in ['main', 'master', 'develop']) {
      if (options.contains(preferred) && preferred != _head) return preferred;
    }
    return options.firstWhere((b) => b != _head, orElse: () => options.first);
  }

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  void _submit() {
    final title = _title.text.trim();
    if (title.isEmpty) {
      setState(() => _error = l10nOf.gitPrTitleRequired);
      return;
    }
    final body = _body.text.trim();
    Navigator.of(context).pop(
      _PrInput(
        title: title,
        body: body.isEmpty ? null : body,
        base: _base,
        head: _head,
      ),
    );
  }

  AppLocalizations get l10nOf => AppLocalizations.of(context);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Dialog.fullscreen(
      child: NeScaffold(
        title: l10n.gitPrDialogTitle,
        // Full-screen dialog: a close (✕) Icon Surface + the affirmative
        // action, content centred at 560 dp scrolling under the top veil —
        // same chrome as the new-conversation dialog.
        leading: IconSurface(
          icon: Icons.close_rounded,
          tooltip: l10n.gitCancel,
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: UxnanSpacing.sm),
            child: TextButton(
              onPressed: _submit,
              child: Text(l10n.gitPrCreate),
            ),
          ),
        ],
        slivers: [
          SliverToBoxAdapter(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: Padding(
                  padding: const EdgeInsets.all(UxnanSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        controller: _title,
                        autofocus: true,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: InputDecoration(
                          labelText: l10n.gitPrTitleLabel,
                          errorText: _error,
                          border: const OutlineInputBorder(
                            borderRadius: BorderRadius.all(UxnanRadius.lg),
                          ),
                        ),
                      ),
                      const SizedBox(height: UxnanSpacing.lg),
                      _BranchField(
                        label: l10n.gitPrHeadLabel,
                        icon: Icons.upload_rounded,
                        value: _head,
                        options: _headOptions,
                        onChanged: (v) => setState(() => _head = v),
                      ),
                      const SizedBox(height: UxnanSpacing.sm),
                      Center(
                        child: Icon(
                          Icons.arrow_downward_rounded,
                          size: 18,
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: UxnanSpacing.sm),
                      _BranchField(
                        label: l10n.gitPrBaseLabel,
                        icon: Icons.flag_outlined,
                        value: _base,
                        options: _baseOptions,
                        onChanged: (v) => setState(() => _base = v),
                      ),
                      const SizedBox(height: UxnanSpacing.md),
                      Row(
                        children: [
                          Icon(
                            Icons.info_outline_rounded,
                            size: 16,
                            color: colors.onSurfaceVariant,
                          ),
                          const SizedBox(width: UxnanSpacing.sm),
                          Expanded(
                            child: Text(
                              l10n.gitPrPushNote,
                              style: textTheme.bodySmall?.copyWith(
                                color: colors.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: UxnanSpacing.lg),
                      TextField(
                        controller: _body,
                        minLines: 4,
                        maxLines: 10,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: InputDecoration(
                          labelText: l10n.gitPrBodyLabel,
                          alignLabelWithHint: true,
                          border: const OutlineInputBorder(
                            borderRadius: BorderRadius.all(UxnanRadius.lg),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A labelled branch picker: a dropdown when options are known, else a plain
/// text field (so a user can still type a branch the bridge didn't list).
class _BranchField extends StatelessWidget {
  const _BranchField({
    required this.label,
    required this.icon,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final IconData icon;
  final String? value;
  final List<String> options;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) {
      return TextField(
        controller: TextEditingController(text: value ?? ''),
        onChanged: onChanged,
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon),
          border: const OutlineInputBorder(),
        ),
      );
    }
    return DropdownButtonFormField<String>(
      initialValue: options.contains(value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        border: const OutlineInputBorder(),
      ),
      items: [
        for (final branch in options)
          DropdownMenuItem(
            value: branch,
            child: Text(branch, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: onChanged,
    );
  }
}

// ---------------------------------------------------------------------------
// Local NE primitives
//
// These three widgets live here because they're only used by `git_screen.dart`
// today. If they get reused by another screen, hoist them into the shared
// `presentation/widgets/` tree.
// ---------------------------------------------------------------------------

/// A rounded NE surface used in place of M3's `Card.filled` / `Card.outlined`.
/// Filled by default on `surfaceContainerHigh`; the `outlined` flag adds a thin
/// `outlineVariant` border so cards nested inside other surfaces remain
/// legible. No drop shadow — NE is flat by design.
class NeSurface extends StatelessWidget {
  /// Creates a [NeSurface].
  const NeSurface({
    required this.child,
    this.outlined = false,
    this.padding = const EdgeInsets.all(UxnanSpacing.md),
    super.key,
  });

  /// The widget this surface wraps.
  final Widget child;

  /// Whether to draw a thin `outlineVariant` border (use when the card sits
  /// on a background that matches `surfaceContainerHigh`).
  final bool outlined;

  /// Padding applied to [child].
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerHigh,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: outlined
            ? BorderSide(color: colors.outlineVariant)
            : BorderSide.none,
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(padding: padding, child: child),
    );
  }
}

/// An M3-style checkbox rendered as a circular NE surface so the gesture
/// ripple matches the rest of the screen. `null` renders an indeterminate
/// (mixed) state — partial selection across the list.
class _NeCheckbox extends StatelessWidget {
  /// Creates an [_NeCheckbox].
  const _NeCheckbox({required this.value, required this.onChanged});

  /// `true` = checked, `false` = unchecked, `null` = indeterminate.
  final bool? value;

  /// Tap handler; receives the new state (`true` / `false`).
  final ValueChanged<bool?> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isOn = value ?? false;
    final isMixed = value == null;
    return _NeSelectionSurface(
      icon: isMixed
          ? Icons.remove_rounded
          : (isOn
              ? Icons.check_rounded
              : Icons.check_box_outline_blank_rounded),
      tooltip: isMixed ? 'Mixed' : (isOn ? 'Selected' : 'Not selected'),
      selected: isOn || isMixed,
      // When off, force the empty-box glyph in onSurfaceVariant.
      foreground: isOn || isMixed ? colors.onPrimary : colors.onSurfaceVariant,
      onPressed: () => onChanged(!(value ?? false)),
    );
  }
}

/// Internal helper for [_NeCheckbox] — a circular surface with the M3 press
/// scale spring from [IconSurface] but no tooltip tooltips inside the file
/// card (the file card has its own discards; we only want the press ripple).
class _NeSelectionSurface extends StatelessWidget {
  const _NeSelectionSurface({
    required this.icon,
    required this.tooltip,
    required this.selected,
    required this.foreground,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final bool selected;
  final Color foreground;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final background = selected ? colors.primary : colors.surfaceContainerHigh;
    final fg = selected ? foreground : colors.onSurfaceVariant;
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onPressed,
        child: Padding(
          // 8 dp touch padding around a 24 dp visual — keeps the file-row
          // tap target roomy without making the glyph feel oversized.
          padding: const EdgeInsets.all(UxnanSpacing.xs),
          child: Material(
            color: background,
            shape: const CircleBorder(),
            clipBehavior: Clip.antiAlias,
            child: SizedBox(
              width: 24,
              height: 24,
              child: Center(
                child: Icon(
                  icon,
                  size: 18,
                  color: fg,
                  semanticLabel: tooltip,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Filled primary action button for the commit composer's primary slot. The
/// M3 `IconButton.filled` shows a square ripple that breaks the round NE
/// gesture language; this widget keeps the round press feedback and adds a
/// 16 dp spinner slot while a git action is in flight.
class _PrimaryActionButton extends StatelessWidget {
  const _PrimaryActionButton({
    required this.icon,
    required this.tooltip,
    required this.busy,
    required this.onPressed,
    this.badge,
  });

  final IconData icon;
  final String tooltip;
  final bool busy;
  final VoidCallback? onPressed;
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final enabled = onPressed != null;
    // The spinner's colour follows the foreground token (onPrimary) so it
    // stays legible whether the button is enabled or disabled — never a
    // raw `Colors.white` literal.
    final foreground =
        enabled ? colors.onPrimary : colors.onPrimary.withValues(alpha: 0.5);
    final spinner = busy
        ? SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation<Color>(foreground),
            ),
          )
        : Icon(icon, size: 20, color: foreground);
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onPressed,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Material(
              color: enabled ? colors.primary : colors.surfaceContainerHigh,
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: SizedBox(
                  width: 48, height: 48, child: Center(child: spinner)),
            ),
            if (badge != null) badge!,
          ],
        ),
      ),
    );
  }
}

/// Tappable row that toggles expansion on tap — a Material+InkWell rounded to
/// the surface radius so the press ripple stays inside the file card. Used
/// by [_FileCard] so the entire row is the tap target (not just the icon).
class _ExpandableRow extends StatelessWidget {
  const _ExpandableRow({required this.child, required this.onTap});
  final Widget child;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.xs,
            vertical: UxnanSpacing.sm,
          ),
          child: child,
        ),
      ),
    );
  }
}
