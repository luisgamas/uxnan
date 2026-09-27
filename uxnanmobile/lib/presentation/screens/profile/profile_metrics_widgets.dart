import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';

/// The activity highlights of a [ProfileMetrics] set (every PC, or one on its
/// details screen): the two figures that say how much you worked with your
/// agents — conversations and messages — large, then the rest as quiet facts
/// in a grid that is two or three columns wide as the width allows.
class ActivityHighlights extends StatelessWidget {
  /// Creates an [ActivityHighlights].
  const ActivityHighlights({required this.metrics, super.key});

  /// The metrics to render.
  final ProfileMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
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
    return NeCard(
      padding: const EdgeInsets.all(UxnanSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: _Figure(
                  value: number.format(m.conversations),
                  label: l10n.statConversations,
                  large: true,
                ),
              ),
              Expanded(
                child: _Figure(
                  value: number.format(m.messages),
                  label: l10n.statMessages,
                  large: true,
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.md),
            child: Divider(height: 1, color: colors.outlineVariant),
          ),
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth < 300 ? 2 : 3;
              final width = constraints.maxWidth / columns;
              return Wrap(
                runSpacing: UxnanSpacing.md,
                children: [
                  for (final (value, label) in facts)
                    SizedBox(
                      width: width,
                      child: _Figure(value: value, label: label),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: large
              ? textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w600)
              : textTheme.titleMedium,
        ),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: textTheme.labelMedium?.copyWith(
            color: colors.onSurfaceVariant,
          ),
        ),
      ],
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
