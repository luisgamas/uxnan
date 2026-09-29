import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Renders a single file's unified diff inside an expanded file card.
///
/// Drives a [FutureBuilder] over the per-file `git/diff` request: shows a slim
/// progress line while loading, an inline error or empty-state when there's
/// nothing textual to show, and otherwise the colored +/- lines (git diff
/// file headers are dropped; `@@` hunks are dimmed). Horizontally scrollable so
/// long code lines don't wrap awkwardly on a phone.
class GitDiffView extends StatelessWidget {
  /// Creates a [GitDiffView].
  const GitDiffView({required this.future, super.key});

  /// The in-flight per-file diff; null when no workspace is known.
  final Future<GitFileDiff>? future;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final future = this.future;
    if (future == null) {
      return _Message(text: l10n.gitDiffEmpty);
    }
    return FutureBuilder<GitFileDiff>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(UxnanSpacing.md),
            child: LinearProgressIndicator(),
          );
        }
        if (snapshot.hasError) {
          return _Message(text: l10n.gitDiffError);
        }
        final diff = snapshot.data?.diff ?? '';
        final lines = _renderableLines(diff);
        if (lines.isEmpty) {
          return _Message(text: l10n.gitDiffEmpty);
        }
        // Horizontal scroll so long code lines don't wrap. The Column's
        // cross-axis (width) is unbounded inside a horizontal scroll view, so
        // wrap it in IntrinsicWidth: every colored line then stretches to the
        // widest line's width and the +/- backgrounds line up cleanly.
        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Padding(
            padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
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
                          style: UxnanTypography.codeSmall,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        );
      },
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
    // Trim a trailing empty line so the card doesn't end on blank space.
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
}

class _Message extends StatelessWidget {
  const _Message({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.md,
        0,
        UxnanSpacing.md,
        UxnanSpacing.md,
      ),
      child: Text(
        text,
        style: UxnanTypography.codeSmall.copyWith(
          color: colors.onSurfaceVariant,
        ),
      ),
    );
  }
}
