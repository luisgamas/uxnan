import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/profile_metrics.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The headline stat tiles for a [ProfileMetrics] set (all PCs, or one PC on
/// the details screen), adapting from two columns on narrow phones to three on
/// standard phones and wider surfaces.
class MetricsStatGrid extends StatelessWidget {
  /// Creates a [MetricsStatGrid].
  const MetricsStatGrid({required this.metrics, super.key});

  /// The metrics to render.
  final ProfileMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final m = metrics;
    // Order: connection stats first, then conversation volume, then
    // work/details (three tiles per row).
    final tiles = <_StatTile>[
      _StatTile(
        value: fmtDuration(m.totalConnected),
        label: l10n.statTimeConnected,
      ),
      _StatTile(
        value: fmtDuration(m.longestSession),
        label: l10n.statLongestSession,
      ),
      _StatTile(value: '${m.agentsUsed}', label: l10n.statAgentsUsed),
      _StatTile(value: '${m.conversations}', label: l10n.statConversations),
      _StatTile(value: '${m.messages}', label: l10n.statMessages),
      _StatTile(value: '${m.sessions}', label: l10n.statSessions),
      // Row 3: total tokens, models, git actions.
      _StatTile(value: fmtTokens(m.totalTokens), label: l10n.statTotalTokens),
      _StatTile(value: '${m.modelsUsed}', label: l10n.statModelsUsed),
      _StatTile(value: '${m.gitActions}', label: l10n.statGitActions),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth < 340 ? 2 : 3;
        final tileWidth =
            (constraints.maxWidth - UxnanSpacing.sm * (columns - 1)) / columns;
        return Wrap(
          spacing: UxnanSpacing.sm,
          runSpacing: UxnanSpacing.sm,
          children: [
            for (final tile in tiles) SizedBox(width: tileWidth, child: tile),
          ],
        );
      },
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    // A fixed height keeps every tile in a row the same size (labels may wrap
    // to two lines) without a cross-axis stretch, which would demand an
    // unbounded height inside the scrolling sliver.
    return Container(
      height: 96,
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.md,
        vertical: UxnanSpacing.md,
      ),
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
            style: textTheme.headlineMedium?.copyWith(color: colors.onSurface),
          ),
          const SizedBox(height: 2),
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

/// Formats a token count compactly: `840`, `1.2K`, `231K`, `1.5M`.
String fmtTokens(int n) {
  if (n < 1000) return '$n';
  if (n < 1000000) {
    final k = n / 1000;
    return k >= 10 ? '${k.round()}K' : '${k.toStringAsFixed(1)}K';
  }
  final m = n / 1000000;
  return m >= 10 ? '${m.round()}M' : '${m.toStringAsFixed(1)}M';
}
