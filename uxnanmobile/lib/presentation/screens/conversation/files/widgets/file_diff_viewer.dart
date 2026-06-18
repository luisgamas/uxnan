import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Renders a file's unified git diff with the +/- line coloring matching the
/// conversation's `GitDiffView` (alpha-tinted backgrounds + the `gitAdded` /
/// `gitDeleted` brand colors). Hunk headers (`@@`) are dimmed; file-level
/// metadata (`diff --git …`, `index …`, `--- /+++`, …) is dropped.
///
/// The diff is horizontally scrollable so long code lines don't wrap. A
/// vertical scroll sits above so the full file is readable on a phone screen.
class FileDiffViewer extends StatelessWidget {
  /// Creates a [FileDiffViewer].
  const FileDiffViewer({
    required this.diff,
    required this.path,
    super.key,
  });

  /// The unified diff text (`git/diff { path }` result).
  final String diff;

  /// Workspace-relative file path (for the small header above the diff).
  final String path;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final lines = _renderableLines(diff);
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _DiffHeader(
            path: path,
            added: _count(lines, '+'),
            deleted: _count(lines, '-'),
          ),
          if (lines.isEmpty)
            Padding(
              padding: const EdgeInsets.all(UxnanSpacing.lg),
              child: Text(
                'No textual changes to show.',
                style: UxnanTypography.codeSmall.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            )
          else
            SingleChildScrollView(
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
                            style: UxnanTypography.codeBody,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  /// Drops the noisy git file-header lines, keeping hunk markers and content.
  List<String> _renderableLines(String diff) {
    final result = <String>[];
    for (final line in diff.split('\n')) {
      if (line.startsWith('diff --git ') ||
          line.startsWith('index ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('new file mode ') ||
          line.startsWith('deleted file mode ') ||
          line.startsWith('similarity index ') ||
          line.startsWith('rename from ') ||
          line.startsWith('rename to ')) {
        continue;
      }
      result.add(line);
    }
    while (result.isNotEmpty && result.last.trim().isEmpty) {
      result.removeLast();
    }
    return result;
  }

  Color _lineColor(String line) {
    if (line.startsWith('@@')) {
      return UxnanColors.gitUntracked.withValues(alpha: 0.10);
    }
    if (line.startsWith('+')) {
      return UxnanColors.gitAdded.withValues(alpha: 0.12);
    }
    if (line.startsWith('-')) {
      return UxnanColors.gitDeleted.withValues(alpha: 0.12);
    }
    return Colors.transparent;
  }

  int _count(List<String> lines, String prefix) {
    var n = 0;
    for (final line in lines) {
      if (line.startsWith(prefix)) n++;
    }
    return n;
  }
}

/// A small header above the diff body: the file path + green/red counters,
/// matching the `_DiffNumericPill` in `ConversationScreen`.
class _DiffHeader extends StatelessWidget {
  const _DiffHeader({
    required this.path,
    required this.added,
    required this.deleted,
  });
  final String path;
  final int added;
  final int deleted;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.sm,
        UxnanSpacing.lg,
        UxnanSpacing.xs,
      ),
      child: Row(
        children: [
          Icon(
            Icons.difference_rounded,
            size: 18,
            color: colors.onSurfaceVariant,
          ),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Text(
              path,
              style: textTheme.titleSmall,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (added > 0)
            Text(
              '+$added',
              style: UxnanTypography.codeSmall.copyWith(
                color: UxnanColors.gitAdded,
              ),
            ),
          if (added > 0 && deleted > 0) const SizedBox(width: UxnanSpacing.sm),
          if (deleted > 0)
            Text(
              '−$deleted',
              style: UxnanTypography.codeSmall.copyWith(
                color: UxnanColors.gitDeleted,
              ),
            ),
        ],
      ),
    );
  }
}
