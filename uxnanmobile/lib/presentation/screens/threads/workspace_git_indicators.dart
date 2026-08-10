import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/workspace_git_provider.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// What a working folder's git state looks like on its row: uncommitted work,
/// and how far it has drifted from its remote.
///
/// Three rules, all of them borrowed from `uxnandesktop` because they are what
/// makes a dense row readable:
///
/// - **Zero is never drawn.** "↑0" is not information, it is noise that has to
///   be read before it can be discarded.
/// - **At most three signals.** Past that a row stops being scannable and
///   becomes a table; the full breakdown lives one long-press away.
/// - **Nothing claims to be clean.** With no answer the row draws nothing,
///   which reads as *unknown*. Drawing "clean" for a folder we could not reach
///   would be a lie that looks exactly like good news.
class WorkspaceGitIndicators extends ConsumerWidget {
  /// Creates a [WorkspaceGitIndicators] for the folder at [cwd].
  const WorkspaceGitIndicators({required this.cwd, super.key});

  /// Absolute path of the folder.
  final String cwd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Watching from HERE, rather than from the row, is what keeps the fetch
    // tied to whether the indicators are actually on screen.
    final async = ref.watch(workspaceGitProvider(cwd));
    final value = async.value;
    final git = value?.git;
    if (git == null) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    // A remembered answer is shown at half strength: still useful, visibly not
    // current. The alternative — hiding it — loses the only information there
    // is the moment a PC drops.
    final muted = value!.stale
        ? colors.onSurfaceVariant.withValues(alpha: 0.5)
        : colors.onSurfaceVariant;

    final dirty = git.changedFiles.length;
    final signals = <Widget>[
      if (git.isDirty && dirty > 0)
        _Signal(
          label: '$dirty',
          color: value.stale
              ? UxnanColors.warning.withValues(alpha: 0.5)
              : UxnanColors.warning,
          leading: _DirtyDot(
            color: value.stale
                ? UxnanColors.warning.withValues(alpha: 0.5)
                : UxnanColors.warning,
          ),
          semantics: l10n.workspaceDirty(dirty),
        )
      // `isDirty` without a file list still deserves saying: the bridge knows
      // the tree is dirty even when it sends no per-file detail.
      else if (git.isDirty)
        _Signal(
          label: '',
          color: muted,
          leading: const _DirtyDot(color: UxnanColors.warning),
          semantics: l10n.workspaceDirty(1),
        ),
      if (git.ahead > 0)
        _Signal(
          label: '↑${git.ahead}',
          color: muted,
          semantics: l10n.workspaceAhead(git.ahead),
        ),
      if (git.behind > 0)
        _Signal(
          label: '↓${git.behind}',
          color: muted,
          semantics: l10n.workspaceBehind(git.behind),
        ),
    ];
    if (signals.isEmpty) return const SizedBox.shrink();

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final signal in signals.take(3))
          Padding(
            padding: const EdgeInsets.only(left: UxnanSpacing.xs),
            child: DefaultTextStyle.merge(
              style: textTheme.labelSmall ?? const TextStyle(),
              child: signal,
            ),
          ),
      ],
    );
  }
}

class _Signal extends StatelessWidget {
  const _Signal({
    required this.label,
    required this.color,
    required this.semantics,
    this.leading,
  });

  final String label;
  final Color color;
  final String semantics;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semantics,
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (leading != null) ...[
              leading!,
              if (label.isNotEmpty) const SizedBox(width: 3),
            ],
            if (label.isNotEmpty) Text(label, style: TextStyle(color: color)),
          ],
        ),
      ),
    );
  }
}

/// The uncommitted-work mark: a dot, not a glyph.
///
/// At this size a stroked icon would be a smudge; a filled dot in the warning
/// tone is legible at 6 dp and reads instantly against the neutral counters
/// beside it.
class _DirtyDot extends StatelessWidget {
  const _DirtyDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
