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
      builder: (_) => _BranchPicker(branches: branches, current: state.branch),
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

    final colors = Theme.of(context).colorScheme;
    final topInset = NeTopBar.preferredHeight(context);
    return Scaffold(
      body: Stack(
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
                              child: _BranchSummary(
                                state: state,
                                onSwitchBranch: _busy || widget.cwd == null
                                    ? null
                                    : () => _switchBranch(state),
                              ),
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
                    onPush: () => _push(state),
                    onUndoCommit: () => _undoCommit(state),
                    onCreatePr: () => _createPr(state),
                    onDiscardAll: () => _discard(state, all: true),
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

/// App-bar overflow with the non-selection actions: push and PR.
class _OverflowMenu extends StatelessWidget {
  const _OverflowMenu({
    required this.state,
    required this.busy,
    required this.onPush,
    required this.onUndoCommit,
    required this.onCreatePr,
    required this.onDiscardAll,
  });

  final GitRepoState state;
  final bool busy;
  final VoidCallback onPush;
  final VoidCallback onUndoCommit;
  final VoidCallback onCreatePr;
  final VoidCallback onDiscardAll;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return PopupMenuButton<void>(
      tooltip: l10n.threadsMore,
      position: PopupMenuPosition.under,
      constraints: const BoxConstraints(minWidth: 220),
      child: SizedBox(
        width: 48,
        height: 48,
        child: Center(
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: colors.surfaceContainerHigh,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.more_vert_rounded,
              size: 20,
              color: colors.onSurfaceVariant,
            ),
          ),
        ),
      ),
      itemBuilder: (_) => [
        PopupMenuItem(
          enabled: !busy && state.hasUnpushedCommits,
          onTap: onPush,
          child: _MenuRow(
            icon: Icons.arrow_upward_rounded,
            label: l10n.gitPushButton,
          ),
        ),
        if (state.hasUnpushedCommits)
          PopupMenuItem(
            enabled: !busy,
            onTap: onUndoCommit,
            child: _MenuRow(
              icon: Icons.undo_rounded,
              label: l10n.gitUndoCommit,
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

/// Branch, upstream, ahead/behind and aggregate diff counters, with a control
/// to switch branches.
class _BranchSummary extends StatelessWidget {
  const _BranchSummary({required this.state, this.onSwitchBranch});
  final GitRepoState state;
  final VoidCallback? onSwitchBranch;

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
      child: Card.filled(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.md),
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
                  const SizedBox(width: UxnanSpacing.xs),
                  IconButton(
                    tooltip: l10n.gitSwitchBranch,
                    visualDensity: VisualDensity.compact,
                    onPressed: onSwitchBranch,
                    icon: const Icon(Icons.swap_horiz_rounded, size: 20),
                  ),
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
                    color: state.isDirty
                        ? UxnanColors.warning
                        : UxnanColors.success,
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

/// Select-all control, the selected/total count and *Discard selected*.
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
          Checkbox(
            value: none ? false : (all ? true : null),
            tristate: true,
            onChanged: (_) => all ? onDeselectAll() : onSelectAll(),
          ),
          Expanded(
            child: Text(
              l10n.gitSelectedCount(selected, total),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
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

/// A collapsible card for one changed file: selection checkbox, status icon,
/// name/path title, green/red counter, and the per-line diff body.
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
      child: Card.outlined(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            InkWell(
              onTap: () => onExpandedChanged(!expanded),
              child: Padding(
                padding: const EdgeInsets.only(
                  left: UxnanSpacing.xs,
                  right: UxnanSpacing.sm,
                  top: UxnanSpacing.xs,
                  bottom: UxnanSpacing.xs,
                ),
                child: Row(
                  children: [
                    Checkbox(
                      value: selected,
                      onChanged: (value) => onSelectedChanged(value ?? false),
                    ),
                    Icon(icon, size: 18, color: color, semanticLabel: label),
                    const SizedBox(width: UxnanSpacing.sm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name,
                            style: textTheme.titleSmall,
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
                    IconButton(
                      tooltip: l10n.gitDiscard,
                      visualDensity: VisualDensity.compact,
                      onPressed: onDiscard,
                      icon: Icon(
                        Icons.undo_rounded,
                        size: 18,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    Icon(
                      expanded
                          ? Icons.expand_less_rounded
                          : Icons.expand_more_rounded,
                      color: colors.onSurfaceVariant,
                    ),
                  ],
                ),
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
/// Commit / Push action row.
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final canCommit = state.isDirty && !busy;
    final hasPush = state.hasUnpushedCommits;
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
                      if (hasPush)
                        IconButton.filledTonal(
                          tooltip: '${l10n.gitPushButton} (${state.ahead})',
                          visualDensity: VisualDensity.compact,
                          onPressed: busy ? null : onPush,
                          icon: busy
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Badge.count(
                                  count: state.ahead,
                                  child: const Icon(
                                    Icons.arrow_upward_rounded,
                                  ),
                                ),
                        ),
                      IconButton(
                        tooltip: l10n.gitCommitDescriptionLabel,
                        isSelected: showDetails,
                        visualDensity: VisualDensity.compact,
                        onPressed: canCommit ? onToggleDetails : null,
                        icon: Icon(
                          showDetails
                              ? Icons.expand_more_rounded
                              : Icons.notes_rounded,
                        ),
                      ),
                      const SizedBox(width: UxnanSpacing.xs),
                      IconButton.filled(
                        tooltip: l10n.gitCommitButton,
                        onPressed: canCommit ? onCommit : null,
                        icon: busy && !hasPush
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.check_rounded),
                      ),
                    ],
                  ),
                  // Optional fields slide in below (morphing pill → rectangle).
                  AnimatedSize(
                    duration: const Duration(milliseconds: 220),
                    curve: Curves.easeOutCubic,
                    alignment: Alignment.topCenter,
                    child: showDetails
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
/// the current branch shown at the top, disabled.
class _BranchPicker extends StatelessWidget {
  const _BranchPicker({required this.branches, required this.current});

  final GitBranchList branches;
  final String current;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final options = <String>{
      ...branches.local,
      ...branches.remote.map(_bareBranch),
    }..remove(current);
    final others = options.toList()..sort();
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
          ListTile(
            leading: Icon(Icons.check_rounded, color: colors.primary),
            title: Text(current),
            subtitle: Text(l10n.gitSwitchBranchCurrent(current)),
            enabled: false,
          ),
          if (others.isNotEmpty)
            Divider(height: 1, color: colors.outlineVariant),
          for (final branch in others)
            ListTile(
              leading: Icon(
                Icons.account_tree_outlined,
                color: colors.onSurfaceVariant,
              ),
              title: Text(branch, overflow: TextOverflow.ellipsis),
              onTap: () => Navigator.of(context).pop(branch),
            ),
        ],
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
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const Icon(Icons.close_rounded),
            onPressed: () => Navigator.of(context).pop(),
          ),
          title: Text(l10n.gitPrDialogTitle),
          actions: [
            TextButton(
              onPressed: _submit,
              child: Text(l10n.gitPrCreate),
            ),
            const SizedBox(width: UxnanSpacing.sm),
          ],
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(UxnanSpacing.lg),
            children: [
              TextField(
                controller: _title,
                autofocus: true,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  labelText: l10n.gitPrTitleLabel,
                  errorText: _error,
                  border: const OutlineInputBorder(),
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
                  border: const OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
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
