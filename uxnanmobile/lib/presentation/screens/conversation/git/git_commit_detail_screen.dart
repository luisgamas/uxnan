import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_commit_details.dart';
import 'package:uxnan/domain/value_objects/git/git_log.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/git/widgets/commit_ref_chip.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Full-screen detail for a single commit, backed by `git/commitShow`.
///
/// Shows everything git can tell us about the commit: the full message, the
/// refs that point at it (branch/tag chips), author + committer + dates, the
/// full SHA (copyable), the parents, the aggregate stats, the list of files it
/// touched (status + per-file +/-), and the complete unified diff.
class GitCommitDetailScreen extends ConsumerStatefulWidget {
  /// Creates a [GitCommitDetailScreen].
  const GitCommitDetailScreen({
    required this.cwd,
    required this.sha,
    this.seed,
    super.key,
  });

  /// Workspace directory the commit lives in.
  final String cwd;

  /// The commit to inspect (full SHA).
  final String sha;

  /// Optional already-known commit metadata (from the history list), painted
  /// as the header while the full detail loads.
  final GitCommit? seed;

  /// Pushes the screen onto the navigator.
  static Future<void> push(
    BuildContext context, {
    required String cwd,
    required String sha,
    GitCommit? seed,
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => GitCommitDetailScreen(cwd: cwd, sha: sha, seed: seed),
      ),
    );
  }

  @override
  ConsumerState<GitCommitDetailScreen> createState() =>
      _GitCommitDetailScreenState();
}

class _GitCommitDetailScreenState extends ConsumerState<GitCommitDetailScreen> {
  GitCommitDetails? _details;
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final details = await ref
          .read(gitActionManagerProvider)
          .commitShow(widget.cwd, widget.sha);
      if (!mounted) return;
      setState(() {
        _details = details;
        _loading = false;
      });
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  void _copy(String text, String toast) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(toast)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final details = _details;
    final commit = details?.commit ?? widget.seed;

    // Each section is its own sliver (NeScaffold renders these in a
    // CustomScrollView — they must be slivers, not box widgets).
    final slivers = <Widget>[];
    if (commit != null) {
      slivers.add(
        SliverToBoxAdapter(
          child: _Header(
            commit: commit,
            onCopySha: () => _copy(commit.sha, l10n.gitHistoryCopiedSha),
            onCopyMessage: () => _copy(
              '${commit.messageTitle}\n\n${commit.messageBody}'.trim(),
              l10n.gitHistoryCopiedMessage,
            ),
          ),
        ),
      );
    }

    if (_loading && details == null) {
      slivers.add(
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xxl),
            child: Center(
              child: PolygonLoader(size: 40, color: colors.primary),
            ),
          ),
        ),
      );
    } else if (_error != null && details == null) {
      slivers.add(
        SliverToBoxAdapter(
          child: _InlineError(
            title: l10n.gitHistoryDetailLoadFailed,
            retryLabel: l10n.gitHistoryRetry,
            onRetry: _load,
          ),
        ),
      );
    } else if (details != null) {
      slivers
        ..add(SliverToBoxAdapter(child: _FilesSection(files: details.files)))
        ..add(
          SliverToBoxAdapter(
            child: _DiffSection(
              diff: details.diff,
              truncated: details.diffTruncated,
            ),
          ),
        );
    }

    slivers.add(
      const SliverToBoxAdapter(child: SizedBox(height: UxnanSpacing.xxl)),
    );

    return NeScaffold(
      title: l10n.gitHistoryDetailsTitle,
      slivers: slivers,
    );
  }
}

/// The metadata header: title, refs, body, author/committer, SHA, parents,
/// stats, and the copy actions.
class _Header extends StatelessWidget {
  const _Header({
    required this.commit,
    required this.onCopySha,
    required this.onCopyMessage,
  });

  final GitCommit commit;
  final VoidCallback onCopySha;
  final VoidCallback onCopyMessage;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final stats = commit.stats;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        UxnanSpacing.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SelectableText(
            commit.messageTitle,
            style: textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
          if (commit.refs.isNotEmpty) ...[
            const SizedBox(height: UxnanSpacing.sm),
            Wrap(
              spacing: UxnanSpacing.xs,
              runSpacing: UxnanSpacing.xs,
              children: [
                for (final ref in commit.refs) CommitRefChip(refData: ref),
              ],
            ),
          ],
          if (commit.messageBody.trim().isNotEmpty) ...[
            const SizedBox(height: UxnanSpacing.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(UxnanSpacing.md),
              decoration: BoxDecoration(
                color: colors.surfaceContainerHigh,
                borderRadius: const BorderRadius.all(UxnanRadius.lg),
              ),
              child: SelectableText(
                commit.messageBody.trim(),
                style: textTheme.bodyMedium,
              ),
            ),
          ],
          const SizedBox(height: UxnanSpacing.md),
          _MetaRow(
            label: l10n.gitHistoryDetailsAuthor,
            value: '${commit.authorName} <${commit.authorEmail}>',
          ),
          _MetaRow(
            label: l10n.gitHistoryDetailsDate,
            value: _fullDate(commit.authorDate),
          ),
          if (commit.committerName != commit.authorName ||
              commit.committerEmail != commit.authorEmail)
            _MetaRow(
              label: l10n.gitHistoryDetailsCommitter,
              value: '${commit.committerName} <${commit.committerEmail}>',
            ),
          const SizedBox(height: UxnanSpacing.sm),
          // SHA pill with copy.
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: UxnanSpacing.md,
              vertical: UxnanSpacing.xs,
            ),
            decoration: BoxDecoration(
              color: colors.surfaceContainerHighest,
              borderRadius: const BorderRadius.all(UxnanRadius.md),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    commit.sha,
                    style: UxnanTypography.codeSmall
                        .copyWith(color: colors.onSurfaceVariant),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  tooltip: l10n.gitHistoryCopySha,
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.content_copy_rounded, size: 18),
                  onPressed: onCopySha,
                ),
              ],
            ),
          ),
          if (commit.parents.isNotEmpty) ...[
            const SizedBox(height: UxnanSpacing.md),
            Text(
              l10n.gitHistoryDetailsParents(commit.parents.length),
              style: textTheme.labelMedium
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: UxnanSpacing.xs),
            Wrap(
              spacing: UxnanSpacing.xs,
              runSpacing: UxnanSpacing.xs,
              children: [
                for (final parent in commit.parents)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: UxnanSpacing.sm,
                      vertical: UxnanSpacing.xs,
                    ),
                    decoration: BoxDecoration(
                      color: colors.surfaceContainerHighest,
                      borderRadius: const BorderRadius.all(UxnanRadius.md),
                    ),
                    child: Text(
                      parent.length < 7 ? parent : parent.substring(0, 7),
                      style: UxnanTypography.codeSmall,
                    ),
                  ),
              ],
            ),
          ],
          if (stats != null) ...[
            const SizedBox(height: UxnanSpacing.md),
            Text(
              l10n.gitHistoryFilesTouched(
                stats.additions,
                stats.deletions,
                stats.changedFileCount,
              ),
              style: textTheme.bodyMedium,
            ),
          ],
          const SizedBox(height: UxnanSpacing.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: onCopyMessage,
              icon: const Icon(Icons.copy_all_rounded, size: 18),
              label: Text(l10n.gitHistoryCopyMessage),
            ),
          ),
        ],
      ),
    );
  }
}

/// The "N files changed" section: one row per file with status + per-file +/-.
class _FilesSection extends StatelessWidget {
  const _FilesSection({required this.files});
  final List<GitCommitFile> files;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.sm,
        UxnanSpacing.lg,
        UxnanSpacing.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            files.isEmpty
                ? l10n.gitHistoryNoFileChanges
                : l10n.gitHistoryDetailsFiles(files.length),
            style: textTheme.labelLarge?.copyWith(
              color: colors.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: UxnanSpacing.xs),
          for (final file in files) _CommitFileRow(file: file),
        ],
      ),
    );
  }
}

/// A single file row in the commit detail.
class _CommitFileRow extends StatelessWidget {
  const _CommitFileRow({required this.file});
  final GitCommitFile file;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final (icon, color) = _statusVisual(file.status);
    final segments = file.path.split('/');
    final name = segments.isEmpty ? file.path : segments.last;
    final dir = segments.length > 1
        ? segments.sublist(0, segments.length - 1).join('/')
        : null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: textTheme.bodyMedium?.copyWith(color: color),
                  overflow: TextOverflow.ellipsis,
                ),
                if (file.oldPath != null)
                  Text(
                    l10n.gitHistoryRenamedFrom(file.oldPath!),
                    style: UxnanTypography.codeSmall
                        .copyWith(color: colors.onSurfaceVariant),
                    overflow: TextOverflow.ellipsis,
                  )
                else if (dir != null)
                  Text(
                    dir,
                    style: UxnanTypography.codeSmall
                        .copyWith(color: colors.onSurfaceVariant),
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
          const SizedBox(width: UxnanSpacing.sm),
          if (file.binary)
            Text(
              'bin',
              style: UxnanTypography.codeSmall
                  .copyWith(color: colors.onSurfaceVariant),
            )
          else ...[
            if (file.additions > 0)
              Text(
                '+${file.additions}',
                style: UxnanTypography.codeSmall
                    .copyWith(color: UxnanColors.gitAdded),
              ),
            if (file.deletions > 0) ...[
              const SizedBox(width: UxnanSpacing.xs),
              Text(
                '−${file.deletions}',
                style: UxnanTypography.codeSmall
                    .copyWith(color: UxnanColors.gitDeleted),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

/// The full unified diff for the commit, colored and horizontally scrollable.
class _DiffSection extends StatelessWidget {
  const _DiffSection({required this.diff, required this.truncated});
  final String diff;
  final bool truncated;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final lines = diff.split('\n');
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.md,
        UxnanSpacing.lg,
        UxnanSpacing.lg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.gitHistoryDiffSection,
            style: textTheme.labelLarge?.copyWith(
              color: colors.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: UxnanSpacing.xs),
          ClipRRect(
            borderRadius: const BorderRadius.all(UxnanRadius.md),
            child: ColoredBox(
              color: colors.surfaceContainerHigh,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: IntrinsicWidth(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final line in lines)
                        ColoredBox(
                          color: _lineColor(line),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: UxnanSpacing.md,
                              vertical: 1,
                            ),
                            child: Text(
                              line.isEmpty ? ' ' : line,
                              style: UxnanTypography.codeBody.copyWith(
                                color: _isMeta(line)
                                    ? colors.onSurfaceVariant
                                    : null,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (truncated) ...[
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              l10n.gitHistoryDiffTruncated,
              style:
                  textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }

  bool _isMeta(String line) =>
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ') ||
      line.startsWith('rename ') ||
      line.startsWith('similarity index ');

  Color _lineColor(String line) {
    if (line.startsWith('@@')) {
      return UxnanColors.gitUntracked.withValues(alpha: 0.10);
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return UxnanColors.gitAdded.withValues(alpha: 0.12);
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return UxnanColors.gitDeleted.withValues(alpha: 0.12);
    }
    return Colors.transparent;
  }
}

/// A label/value metadata row.
class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(
              label,
              style: textTheme.labelMedium?.copyWith(
                color: colors.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(value, style: textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({
    required this.title,
    required this.retryLabel,
    required this.onRetry,
  });
  final String title;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.xl,
        vertical: UxnanSpacing.xxl,
      ),
      child: Column(
        children: [
          Icon(Icons.error_outline_rounded, size: 48, color: colors.error),
          const SizedBox(height: UxnanSpacing.md),
          Text(title, style: textTheme.titleSmall, textAlign: TextAlign.center),
          const SizedBox(height: UxnanSpacing.md),
          FilledButton.tonal(onPressed: onRetry, child: Text(retryLabel)),
        ],
      ),
    );
  }
}

(IconData, Color) _statusVisual(GitFileStatus status) {
  // The mobile enum has no `conflicted` (the bridge maps such files to
  // `modified` on the wire), so these five cases are exhaustive.
  return switch (status) {
    GitFileStatus.added => (Icons.add_circle_outline, UxnanColors.gitAdded),
    GitFileStatus.modified => (Icons.edit_outlined, UxnanColors.gitModified),
    GitFileStatus.deleted => (
        Icons.remove_circle_outline,
        UxnanColors.gitDeleted
      ),
    GitFileStatus.renamed => (
        Icons.drive_file_move_outline,
        UxnanColors.gitModified
      ),
    GitFileStatus.untracked => (
        Icons.fiber_new_outlined,
        UxnanColors.gitUntracked
      ),
  };
}

/// Full date for the detail header: "2024-03-04 12:34".
String _fullDate(DateTime when) {
  String two(int v) => v.toString().padLeft(2, '0');
  return '${when.year}-${two(when.month)}-${two(when.day)} '
      '${two(when.hour)}:${two(when.minute)}';
}
