import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/activity_heatmap.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// When you worked with your agents, and with which: a year of days as a
/// contribution heatmap, then each agent ranked by the conversations it had —
/// the **available** agents (from `agent/list`) plus any with history, so
/// they can be compared. Touching a day scopes the ranking to it (touch it
/// again for all time). What the agents spent is not here: that is the spend
/// section's, read from every session the CLIs recorded.
class AgentActivitySection extends ConsumerStatefulWidget {
  /// Creates an [AgentActivitySection].
  const AgentActivitySection({
    required this.firstYear,
    this.deviceId,
    super.key,
  });

  /// The earliest year the user has data for (bounds the year selector).
  final int firstYear;

  /// When set, scopes everything to a single PC (its `macDeviceId`).
  final String? deviceId;

  @override
  ConsumerState<AgentActivitySection> createState() =>
      _AgentActivitySectionState();
}

class _AgentActivitySectionState extends ConsumerState<AgentActivitySection> {
  late int _year = DateTime.now().year;

  /// The selected heatmap day (UTC midnight), or null for the all-time scope.
  DateTime? _selectedDay;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final currentYear = DateTime.now().year;

    final cache = ref.watch(metricsSnapshotsProvider).value ??
        const <String, MetricsSnapshot>{};
    final scoped = widget.deviceId == null
        ? cache.values.toList()
        : [if (cache[widget.deviceId] != null) cache[widget.deviceId]!];
    final available = <String>[
      for (final a
          in ref.watch(agentsProvider).value ?? const <AgentDescriptor>[])
        // An agent the app has no identity for (the development echo agent
        // parses to `custom`) never has real work to rank.
        if (a.available &&
            AgentIdParsing.fromWireId(a.agentId) != AgentId.custom)
          a.agentId,
    ];
    final ranked = agentBreakdown(
      scoped,
      dayMs: _selectedDay?.millisecondsSinceEpoch,
      includeAgents: available,
    );
    final top = ranked.fold<int>(
      0,
      (m, a) => a.conversations > m ? a.conversations : m,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        NeCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _YearSelector(
                year: _year,
                canGoBack: _year > widget.firstYear,
                canGoForward: _year < currentYear,
                onChange: (delta) => setState(() {
                  _year += delta;
                  _selectedDay = null;
                }),
              ),
              const SizedBox(height: UxnanSpacing.sm),
              _buildHeatmap(l10n),
            ],
          ),
        ),
        const SizedBox(height: UxnanSpacing.md),
        Text(
          _selectedDay == null
              ? l10n.profileAgentScopeAll
              : DateFormat.yMMMMd().format(_selectedDay!),
          style:
              textTheme.labelMedium?.copyWith(color: colors.onSurfaceVariant),
        ),
        const SizedBox(height: UxnanSpacing.sm),
        NeCard(
          padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
          child: ranked.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(UxnanSpacing.md),
                  child: Text(
                    l10n.profileNoData,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                )
              : Column(
                  children: [
                    for (final entry in ranked)
                      _AgentRank(entry: entry, top: top),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _buildHeatmap(AppLocalizations l10n) {
    final query = (
      metric: ActivityMetric.combined,
      year: _year,
      deviceId: widget.deviceId,
    );
    return ref.watch(activityHeatmapProvider(query)).when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: UxnanSpacing.lg),
            child: Center(child: PolygonLoader(size: UxnanSpacing.xxl)),
          ),
          error: (_, __) => Text(l10n.profileNoData),
          data: (counts) => ActivityHeatmap(
            year: _year,
            countsByDay: counts,
            onSelectedDayChanged: (day) => setState(() => _selectedDay = day),
          ),
        );
  }
}

/// One agent in the ranking: its mark and name, a bar as long as its share of
/// the busiest agent's conversations, and its figures. An available agent
/// with nothing yet reads quieter.
class _AgentRank extends StatelessWidget {
  const _AgentRank({required this.entry, required this.top});

  final MetricsAgentDay entry;
  final int top;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final id = AgentIdParsing.fromWireId(entry.agentId);
    final idle = entry.conversations == 0 && entry.messages == 0;
    final number = NumberFormat.compact();
    return Opacity(
      opacity: idle ? 0.5 : 1,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.md,
          vertical: UxnanSpacing.sm,
        ),
        child: Row(
          children: [
            AgentLogo(agent: id, size: 20, color: colors.onSurface),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          AgentVisuals.labelFor(id),
                          style: textTheme.titleSmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        l10n.profileAgentFigures(
                          number.format(entry.conversations),
                          number.format(entry.messages),
                        ),
                        style: textTheme.labelMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: UxnanSpacing.xs),
                  ClipRRect(
                    borderRadius: const BorderRadius.all(UxnanRadius.full),
                    child: LinearProgressIndicator(
                      value: top == 0 ? 0 : entry.conversations / top,
                      minHeight: 6,
                      color: colors.primary,
                      backgroundColor: colors.surfaceContainerHighest,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _YearSelector extends StatelessWidget {
  const _YearSelector({
    required this.year,
    required this.canGoBack,
    required this.canGoForward,
    required this.onChange,
  });

  final int year;
  final bool canGoBack;
  final bool canGoForward;
  final ValueChanged<int> onChange;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surfaceContainerHigh,
          borderRadius: const BorderRadius.all(UxnanRadius.full),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const UxIcon(UxIcons.chevronLeft),
              tooltip: MaterialLocalizations.of(context).previousMonthTooltip,
              onPressed: canGoBack ? () => onChange(-1) : null,
              visualDensity: VisualDensity.compact,
            ),
            SizedBox(
              width: 52,
              child: Text(
                '$year',
                textAlign: TextAlign.center,
                style: textTheme.titleSmall,
              ),
            ),
            IconButton(
              icon: const UxIcon(UxIcons.chevronRight),
              tooltip: MaterialLocalizations.of(context).nextMonthTooltip,
              onPressed: canGoForward ? () => onChange(1) : null,
              visualDensity: VisualDensity.compact,
            ),
          ],
        ),
      ),
    );
  }
}
