import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/git/git_action_log_entry.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';
import 'package:uxnan/domain/value_objects/git/git_action_progress.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/git/commit_sheet.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Floating source-control panel: branch state, changed files, commit/push
/// actions with live push progress, and recent activity. Modeled on the
/// desktop apps' source-control view and the conversation status sheet.
///
/// Pass the active thread's workspace [cwd]; the panel reads
/// `gitRepoStateProvider` (fed by `git/status`) and runs real commit/push.
class GitActionsSheet extends ConsumerStatefulWidget {
  /// Creates a [GitActionsSheet].
  const GitActionsSheet({
    this.cwd,
    this.threadId,
    super.key,
  });

  /// Workspace directory the git actions run in; null when unknown.
  final String? cwd;

  /// Owning thread, used to record and read action history.
  final String? threadId;

  /// Shows the sheet.
  static Future<void> show(
    BuildContext context, {
    String? cwd,
    String? threadId,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => GitActionsSheet(
        cwd: cwd,
        threadId: threadId,
      ),
    );
  }

  @override
  ConsumerState<GitActionsSheet> createState() => _GitActionsSheetState();
}

class _GitActionsSheetState extends ConsumerState<GitActionsSheet> {
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

  Future<void> _commit(GitRepoState state) async {
    final message = await CommitSheet.show(context);
    if (message == null || !mounted) return;
    final cwd = widget.cwd;
    if (cwd == null) return;
    await _guard(
      () => ref.read(gitActionManagerProvider).commit(
            GitCommitParams(
              cwd: cwd,
              message: message,
              threadId: widget.threadId,
            ),
          ),
      AppLocalizations.of(context).gitCommitSuccess,
    );
  }

  Future<void> _push(GitRepoState state) async {
    final cwd = widget.cwd;
    if (cwd == null) return;
    await _guard(
      () => ref.read(gitActionManagerProvider).push(
            GitPushParams(
              cwd: cwd,
              branch: state.branch,
              threadId: widget.threadId,
            ),
          ),
      AppLocalizations.of(context).gitPushSuccess,
    );
  }

  Future<void> _guard(Future<void> Function() action, String success) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) _toast(success);
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final state = ref.watch(gitRepoStateProvider).value;
    final progress = ref.watch(gitActiveActionProvider).value;
    final history = widget.threadId == null
        ? const <GitActionLogEntry>[]
        : ref.watch(gitActionHistoryProvider(widget.threadId!)).value ??
            const [];

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        child: state == null
            ? const _NoRepository()
            : SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _SectionHeader(label: l10n.gitActionsTitle),
                    _BranchCard(state: state),
                    if (state.changedFiles.isNotEmpty) ...[
                      const SizedBox(height: UxnanSpacing.lg),
                      _SectionHeader(label: l10n.gitChangedFiles),
                      _ChangedFiles(files: state.changedFiles),
                    ],
                    if (progress != null) ...[
                      const SizedBox(height: UxnanSpacing.lg),
                      _PushProgress(progress: progress),
                    ],
                    const SizedBox(height: UxnanSpacing.lg),
                    _Actions(
                      canCommit: state.isDirty && !_busy,
                      canPush: state.hasUnpushedCommits && !_busy,
                      onCommit: () => _commit(state),
                      onPush: () => _push(state),
                    ),
                    if (history.isNotEmpty) ...[
                      const SizedBox(height: UxnanSpacing.lg),
                      _SectionHeader(label: l10n.gitRecent),
                      _History(entries: history),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}

class _NoRepository extends StatelessWidget {
  const _NoRepository();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.source_outlined,
            size: 40,
            color: colors.onSurfaceVariant,
            semanticLabel: 'Source control',
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

class _BranchCard extends StatelessWidget {
  const _BranchCard({required this.state});
  final GitRepoState state;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final totals = state.diffTotals;

    return Container(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
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
                  style: textTheme.titleSmall,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (state.ahead > 0)
                _Counter(icon: Icons.arrow_upward_rounded, value: state.ahead),
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

class _ChangedFiles extends StatelessWidget {
  const _ChangedFiles({required this.files});
  final List<GitChangedFile> files;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        children: [
          for (var i = 0; i < files.length; i++) ...[
            if (i > 0)
              Divider(height: 1, color: colors.outline.withValues(alpha: 0.5)),
            _ChangedFileRow(file: files[i]),
          ],
        ],
      ),
    );
  }
}

class _ChangedFileRow extends StatelessWidget {
  const _ChangedFileRow({required this.file});
  final GitChangedFile file;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final (icon, color, label) = _visualsFor(file.status, l10n);
    final segments = file.path.split('/');
    final name = segments.isEmpty ? file.path : segments.last;
    final dir = segments.length > 1
        ? segments.sublist(0, segments.length - 1).join('/')
        : null;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.md,
        vertical: UxnanSpacing.sm,
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: color, semanticLabel: label),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: textTheme.bodyMedium,
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
        ],
      ),
    );
  }
}

(IconData, Color, String) _visualsFor(
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

class _PushProgress extends StatelessWidget {
  const _PushProgress({required this.progress});
  final GitActionProgress progress;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      padding: const EdgeInsets.all(UxnanSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final phase in progress.phases)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  _PhaseIcon(status: phase.status),
                  const SizedBox(width: UxnanSpacing.sm),
                  Text(phase.name, style: UxnanTypography.codeSmall),
                ],
              ),
            ),
          if (progress.hasError) ...[
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              progress.error!,
              style: UxnanTypography.codeSmall.copyWith(
                color: UxnanColors.error,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PhaseIcon extends StatelessWidget {
  const _PhaseIcon({required this.status});
  final GitActionPhaseStatus status;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return switch (status) {
      GitActionPhaseStatus.pending => Icon(
          Icons.circle_outlined,
          size: 14,
          color: colors.onSurfaceVariant,
        ),
      GitActionPhaseStatus.running => const SizedBox(
          width: 14,
          height: 14,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      GitActionPhaseStatus.completed => const Icon(
          Icons.check_circle,
          size: 14,
          color: UxnanColors.success,
        ),
      GitActionPhaseStatus.error => const Icon(
          Icons.error,
          size: 14,
          color: UxnanColors.error,
        ),
    };
  }
}

class _Actions extends StatelessWidget {
  const _Actions({
    required this.canCommit,
    required this.canPush,
    required this.onCommit,
    required this.onPush,
  });

  final bool canCommit;
  final bool canPush;
  final VoidCallback onCommit;
  final VoidCallback onPush;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Row(
      children: [
        Expanded(
          child: FilledButton.icon(
            onPressed: canCommit ? onCommit : null,
            icon: const Icon(Icons.check_rounded, size: 18),
            label: Text(l10n.gitCommitButton),
          ),
        ),
        const SizedBox(width: UxnanSpacing.md),
        Expanded(
          child: FilledButton.tonalIcon(
            onPressed: canPush ? onPush : null,
            icon: const Icon(Icons.arrow_upward_rounded, size: 18),
            label: Text(l10n.gitPushButton),
          ),
        ),
      ],
    );
  }
}

class _History extends StatelessWidget {
  const _History({required this.entries});
  final List<GitActionLogEntry> entries;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Column(
      children: [
        for (final entry in entries.take(5))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
            child: Row(
              children: [
                Icon(
                  entry.succeeded
                      ? Icons.check_circle_outline
                      : Icons.error_outline,
                  size: 15,
                  color:
                      entry.succeeded ? UxnanColors.success : UxnanColors.error,
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    entry.kind.name,
                    style: textTheme.bodySmall,
                  ),
                ),
                Text(
                  _time(entry.startedAt),
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  String _time(DateTime t) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(t.hour)}:${two(t.minute)}';
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
      child: Text(
        label.toUpperCase(),
        style: textTheme.bodySmall?.copyWith(
          color: colors.onSurfaceVariant,
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}
