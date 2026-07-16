import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/profile_metrics_widgets.dart'
    show fmtTokens;
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/activity_heatmap.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';

/// Which lens the agent-activity block reads through: everyday **activity**
/// (conversations + messages, the default) or **token throughput**.
enum _Lens { activity, tokens }

/// The unified agent-activity block: a lens toggle, a year selector, the
/// contribution [ActivityHeatmap] and a **per-agent breakdown**, all in one
/// section and linked by the heatmap selection.
///
/// The lens switches both the heatmap coloring and the per-agent ordering
/// between activity and tokens. With no day selected the cards show each
/// agent's all-time totals; tapping a heatmap cell scopes them to that day (tap
/// it again to clear). The cards list the **available** agents (from
/// `agent/list`) plus any with history, so you can compare all of them. A
/// persistent note flags that some CLIs don't report token usage, so those
/// figures can be imprecise regardless of which lens is currently selected.
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

  /// The active lens (activity vs tokens).
  _Lens _lens = _Lens.activity;

  /// The selected heatmap day (UTC midnight), or null for the all-time scope.
  DateTime? _selectedDay;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final currentYear = DateTime.now().year;
    final tokensLens = _lens == _Lens.tokens;

    final cache = ref.watch(metricsSnapshotsProvider).value ??
        const <String, MetricsSnapshot>{};
    final scoped = widget.deviceId == null
        ? cache.values.toList()
        : [if (cache[widget.deviceId] != null) cache[widget.deviceId]!];
    final available = <String>[
      for (final a
          in ref.watch(agentsProvider).value ?? const <AgentDescriptor>[])
        // Skip the dev-only placeholder agent (unknown id -> AgentId.custom):
        // it never has real conversations/messages/tokens, so it shouldn't
        // seed a card in the breakdown.
        if (a.available &&
            AgentIdParsing.fromWireId(a.agentId) != AgentId.custom)
          a.agentId,
    ];

    // Per-agent tallies, then ordered/scaled by the active lens so the bars rank
    // by what the user is looking at (conversations, or tokens).
    final breakdown = agentBreakdown(
      scoped,
      dayMs: _selectedDay?.millisecondsSinceEpoch,
      includeAgents: available,
    );
    final ordered = [...breakdown];
    if (tokensLens) {
      ordered.sort((a, b) {
        final byTok = b.tokens.compareTo(a.tokens);
        if (byTok != 0) return byTok;
        final byConv = b.conversations.compareTo(a.conversations);
        if (byConv != 0) return byConv;
        return b.messages.compareTo(a.messages);
      });
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ConnectedButtonGroup<_Lens>(
          values: const [_Lens.activity, _Lens.tokens],
          selected: _lens,
          labelBuilder: (lens, _) => Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                lens == _Lens.activity
                    ? Icons.grid_view_rounded
                    : Icons.toll_rounded,
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Text(
                lens == _Lens.activity
                    ? l10n.profileLensActivity
                    : l10n.profileLensTokens,
              ),
            ],
          ),
          onChanged: (lens) => setState(() {
            _lens = lens;
            // A day picked in one lens no longer describes the other's data.
            _selectedDay = null;
          }),
        ),
        const SizedBox(height: UxnanSpacing.sm),
        _YearSelector(
          year: _year,
          canGoBack: _year > widget.firstYear,
          canGoForward: _year < currentYear,
          onChange: (delta) => setState(() {
            _year += delta;
            _selectedDay = null;
          }),
        ),
        const SizedBox(height: UxnanSpacing.xs),
        _buildHeatmap(l10n),
        const SizedBox(height: UxnanSpacing.sm),
        _TokensNote(text: l10n.profileTokensImprecise),
        const SizedBox(height: UxnanSpacing.md),
        Text(
          _selectedDay == null
              ? l10n.profileAgentScopeAll
              : DateFormat.yMMMMd().format(_selectedDay!),
          style: textTheme.labelSmall?.copyWith(color: colors.onSurfaceVariant),
        ),
        const SizedBox(height: UxnanSpacing.sm),
        if (ordered.isEmpty)
          NeCard(
            child: Text(
              l10n.profileNoData,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          )
        else
          ExpressiveCardGroup(
            count: ordered.length,
            itemBuilder: (context, index, position) => _AgentCard(
              entry: ordered[index],
              tokensLens: tokensLens,
              position: position,
            ),
          ),
      ],
    );
  }

  /// The heatmap for the active lens: activity counts come from the shared
  /// provider (with its drift fallback); token counts are derived from the
  /// cached snapshots' per-day breakdown.
  Widget _buildHeatmap(AppLocalizations l10n) {
    if (_lens == _Lens.tokens) {
      final cache = ref.watch(metricsSnapshotsProvider).value ??
          const <String, MetricsSnapshot>{};
      final scoped = widget.deviceId == null
          ? cache.values.toList()
          : [if (cache[widget.deviceId] != null) cache[widget.deviceId]!];
      return ActivityHeatmap(
        year: _year,
        countsByDay: aggregateTokensByDay(scoped, year: _year),
        onSelectedDayChanged: (day) => setState(() => _selectedDay = day),
        summaryLabel: (total, days) =>
            l10n.profileHeatmapTokensSummary(fmtTokens(total), days),
        dayLabel: (day, count) => l10n.profileHeatmapTokensDay(
          DateFormat.MMMMd().format(day),
          fmtTokens(count),
        ),
      );
    }

    final query = (
      metric: ActivityMetric.combined,
      year: _year,
      deviceId: widget.deviceId,
    );
    return ref.watch(activityHeatmapProvider(query)).when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: UxnanSpacing.lg),
            child: Center(child: CircularProgressIndicator()),
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

/// A single agent's card: an Icon-Surface logo, name and three labeled tallies.
/// The active lens is communicated with quiet tonal stat surfaces instead of
/// an ambiguous progress bar: activity emphasizes conversations + messages,
/// while tokens emphasizes only token usage.
class _AgentCard extends StatelessWidget {
  const _AgentCard({
    required this.entry,
    required this.tokensLens,
    required this.position,
  });

  final MetricsAgentDay entry;
  final bool tokensLens;
  final CardGroupPosition position;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final id = AgentIdParsing.fromWireId(entry.agentId);
    final logo = AgentVisuals.logoFor(id);
    // Available-but-unused agents read as muted.
    final idle =
        entry.conversations == 0 && entry.messages == 0 && entry.tokens == 0;

    return Opacity(
      opacity: idle ? 0.55 : 1,
      child: ExpressiveCard(
        position: position,
        color: colors.surfaceContainer,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerHigh,
                    shape: BoxShape.circle,
                    border: Border.all(color: colors.outline),
                  ),
                  child: Center(
                    child: SizedBox(
                      width: 24,
                      height: 24,
                      child: logo != null
                          ? SvgPicture.asset(logo)
                          : Icon(
                              Icons.smart_toy_outlined,
                              size: 24,
                              color: colors.onSurfaceVariant,
                            ),
                    ),
                  ),
                ),
                const SizedBox(width: UxnanSpacing.md),
                Expanded(
                  child: Text(
                    AgentVisuals.labelFor(id),
                    style: textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: UxnanSpacing.md),
            Row(
              children: [
                Expanded(
                  child: _Stat(
                    value: '${entry.conversations}',
                    label: l10n.profileAgentConvLabel,
                    emphasized: !tokensLens,
                  ),
                ),
                const SizedBox(width: UxnanSpacing.xs),
                Expanded(
                  child: _Stat(
                    value: '${entry.messages}',
                    label: l10n.profileAgentMsgLabel,
                    emphasized: !tokensLens,
                  ),
                ),
                const SizedBox(width: UxnanSpacing.xs),
                Expanded(
                  child: _Stat(
                    value: fmtTokens(entry.tokens),
                    label: l10n.profileAgentTokLabel,
                    emphasized: tokensLens,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// One labeled figure inside an agent card. [emphasized] gives the metric a
/// quiet semantic tonal surface so the active lens reads without adding chart
/// ink or implying that unlike units share a common progress scale.
class _Stat extends StatelessWidget {
  const _Stat({
    required this.value,
    required this.label,
    this.emphasized = false,
  });

  final String value;
  final String label;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.xs,
        vertical: UxnanSpacing.sm,
      ),
      decoration: emphasized
          ? BoxDecoration(
              color: colors.secondaryContainer,
              borderRadius: const BorderRadius.all(UxnanRadius.md),
            )
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w600,
              color:
                  emphasized ? colors.onSecondaryContainer : colors.onSurface,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: textTheme.labelSmall?.copyWith(
              color: emphasized
                  ? colors.onSecondaryContainer
                  : colors.onSurfaceVariant,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

/// The tokens-lens caveat banner: a calm, tonal note that token totals can be
/// imprecise because some CLIs don't report their usage.
class _TokensNote extends StatelessWidget {
  const _TokensNote({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return NeCard(
      color: colors.surfaceContainerHigh,
      padding: const EdgeInsets.all(UxnanSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.info_outline_rounded,
            size: 18,
            color: colors.onSurfaceVariant,
          ),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
        ],
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
              icon: const Icon(Icons.chevron_left_rounded),
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
              icon: const Icon(Icons.chevron_right_rounded),
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
