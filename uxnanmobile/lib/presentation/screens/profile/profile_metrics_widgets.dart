import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The activity figures of a [ProfileMetrics] set (every PC, or one on its
/// details screen), each in its own small container: conversations and
/// messages first, wider and larger — how much you worked with your agents —
/// then the other six in a grid three wide (two on a narrow phone).
class ActivityHighlights extends StatelessWidget {
  /// Creates an [ActivityHighlights].
  const ActivityHighlights({required this.metrics, super.key});

  /// The metrics to render.
  final ProfileMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final m = metrics;
    final number = NumberFormat.decimalPattern();
    final facts = [
      (fmtDuration(m.totalConnected), l10n.statTimeConnected),
      (fmtDuration(m.longestSession), l10n.statLongestSession),
      (number.format(m.sessions), l10n.statSessions),
      ('${m.agentsUsed}', l10n.statAgentsUsed),
      ('${m.modelsUsed}', l10n.statModelsUsed),
      (number.format(m.gitActions), l10n.statGitActions),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: _Tile(
                value: number.format(m.conversations),
                label: l10n.statConversations,
                large: true,
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: _Tile(
                value: number.format(m.messages),
                label: l10n.statMessages,
                large: true,
              ),
            ),
          ],
        ),
        const SizedBox(height: UxnanSpacing.sm),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth < 300 ? 2 : 3;
            final width =
                (constraints.maxWidth - UxnanSpacing.sm * (columns - 1)) /
                    columns;
            return Wrap(
              spacing: UxnanSpacing.sm,
              runSpacing: UxnanSpacing.sm,
              children: [
                for (final (value, label) in facts)
                  SizedBox(
                    width: width,
                    child: _Tile(value: value, label: label),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

/// One figure in its own small container.
class _Tile extends StatelessWidget {
  const _Tile({
    required this.value,
    required this.label,
    this.large = false,
  });

  final String value;
  final String label;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    // A fixed height keeps a row's tiles the same size (labels may wrap to
    // two lines) without a stretch, which the scrolling sliver cannot give.
    return Container(
      height: 96,
      padding: const EdgeInsets.all(UxnanSpacing.md),
      decoration: BoxDecoration(
        color: colors.surfaceContainer,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: large
                ? textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  )
                : textTheme.titleLarge,
          ),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// Formats a [Duration] compactly: `45s`, `12m`, `3h 12m`, `5h`.
String fmtDuration(Duration d) {
  if (d.inSeconds < 60) return '${d.inSeconds}s';
  if (d.inMinutes < 60) return '${d.inMinutes}m';
  final h = d.inHours;
  final m = d.inMinutes % 60;
  return m == 0 ? '${h}h' : '${h}h ${m}m';
}
