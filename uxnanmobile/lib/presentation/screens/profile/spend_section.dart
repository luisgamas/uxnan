import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/value_objects/spend_view.dart';
import 'package:uxnan/domain/value_objects/usage_summary.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/profile/usage_format.dart';
import 'package:uxnan/presentation/theme/motion.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/spend_palette.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/spend_chart.dart';

/// What the agents spent — every model response their CLIs recorded, chats
/// and terminal sessions alike (`usage/summary`), over 7, 30 or 90 days, in
/// cost or tokens. Across every PC, or one when [deviceId] is set.
///
/// A headline figure, a column per day stacked by agent (touch a day for its
/// figures), each agent's share — touch one to focus the chart, the figure
/// and the models on it — and the models behind it. Cost is what the provider
/// billed where the CLI records it, else an estimate at API prices (said so);
/// spend with no known price reads as such, never as $0.
class SpendSection extends ConsumerStatefulWidget {
  /// Creates a [SpendSection].
  const SpendSection({this.deviceId, super.key});

  /// When set, only this PC's spend (its `macDeviceId`).
  final String? deviceId;

  @override
  ConsumerState<SpendSection> createState() => _SpendSectionState();
}

class _SpendSectionState extends ConsumerState<SpendSection> {
  int _period = 30;
  SpendMetric _metric = SpendMetric.cost;
  String? _focus;
  int? _day;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final async = ref.watch(usageSummariesProvider);
    final all = async.value ?? const <String, UsageSummary>{};
    final summaries = widget.deviceId == null
        ? all.values
        : [if (all[widget.deviceId] case final UsageSummary s) s];

    final costView = computeSpendView(summaries, _period, SpendMetric.cost);
    final focusAgent = _focus == null
        ? null
        : costView.agents.where((a) => a.agentId == _focus).firstOrNull;
    // A focused agent with no known price is charted in tokens, not as $0.
    final shownMetric =
        _metric == SpendMetric.cost && (focusAgent?.spend.unpriced ?? false)
            ? SpendMetric.tokens
            : _metric;
    final view = shownMetric == SpendMetric.cost
        ? costView
        : computeSpendView(summaries, _period, shownMetric);
    final legend = _metric == SpendMetric.cost ? costView : view;
    final chartAgents = [
      for (final a in view.agents)
        if (_focus == null || a.agentId == _focus) a.agentId,
    ];
    final shown = focusAgent?.spend ?? view.total;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(l10n.spendTitle, style: textTheme.titleLarge),
            ),
            if (async.isLoading) const PolygonLoader(),
          ],
        ),
        const SizedBox(height: UxnanSpacing.sm),
        Row(
          children: [
            Expanded(
              flex: 3,
              child: ConnectedButtonGroup<int>(
                values: kSpendPeriods,
                selected: _period,
                labelBuilder: (days, _) => Text(l10n.spendPeriodDays(days)),
                onChanged: (days) => setState(() {
                  _period = days;
                  _day = null;
                }),
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              flex: 2,
              child: ConnectedButtonGroup<SpendMetric>(
                values: SpendMetric.values,
                selected: _metric,
                labelBuilder: (metric, _) => Text(
                  metric == SpendMetric.cost
                      ? l10n.spendMetricCost
                      : l10n.spendMetricTokens,
                ),
                onChanged: (metric) => setState(() => _metric = metric),
              ),
            ),
          ],
        ),
        const SizedBox(height: UxnanSpacing.sm),
        if (summaries.isEmpty)
          NeCard(
            child: Text(
              async.isLoading ? l10n.spendReading : l10n.spendNoData,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          )
        else if (view.isEmpty)
          NeCard(
            child: Text(
              l10n.spendEmpty,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          )
        else ...[
          NeCard(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.lg,
              UxnanSpacing.lg,
              UxnanSpacing.md,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Headline(
                  spend: shown,
                  metric: _metric,
                  agentName: focusAgent == null
                      ? null
                      : _agentName(focusAgent.agentId),
                ),
                const SizedBox(height: UxnanSpacing.lg),
                SpendChart(
                  days: view.days,
                  agents: chartAgents,
                  selected: _day,
                  semanticLabel: l10n.spendChartLabel,
                  formatValue: (v) => shownMetric == SpendMetric.cost
                      ? fmtUsd(v)
                      : fmtTokens(v),
                  onSelect: (i) => setState(() => _day = i),
                ),
                const SizedBox(height: UxnanSpacing.xs),
                _Axis(days: view.days),
                AnimatedSize(
                  duration: UxnanMotion.revealIn(context),
                  curve: UxnanMotion.revealCurve,
                  alignment: Alignment.topCenter,
                  child: _day == null
                      ? const SizedBox(width: double.infinity)
                      : _DayDetail(
                          day: view.days[_day!],
                          agents: chartAgents,
                          metric: shownMetric,
                        ),
                ),
              ],
            ),
          ),
          const SizedBox(height: UxnanSpacing.sm),
          NeCard(
            padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
            child: Column(
              children: [
                for (final agent in legend.agents)
                  _AgentRow(
                    agent: agent,
                    metric: _metric,
                    focused: _focus == agent.agentId,
                    dimmed: _focus != null && _focus != agent.agentId,
                    onTap: () => setState(() {
                      _focus = _focus == agent.agentId ? null : agent.agentId;
                      _day = null;
                    }),
                  ),
              ],
            ),
          ),
          const SizedBox(height: UxnanSpacing.sm),
          _Models(
            models: [
              for (final m in view.models)
                if (_focus == null || m.agentId == _focus) m,
            ].take(5).toList(),
          ),
          if (_metric == SpendMetric.cost && shown.estimatedCostUsd > 0) ...[
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              l10n.spendEstimateNote,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ],
    );
  }
}

String _agentName(String agentId) =>
    AgentVisuals.labelFor(AgentIdParsing.fromWireId(agentId));

/// The figure a spend reads as in [metric]: tokens when its cost is unknown.
String _measure(UsageSpend spend, SpendMetric metric) =>
    metric == SpendMetric.cost && !spend.unpriced
        ? fmtUsd(spend.costUsd)
        : fmtTokens(spend.tokens);

class _Headline extends StatelessWidget {
  const _Headline({
    required this.spend,
    required this.metric,
    required this.agentName,
  });

  final UsageSpend spend;
  final SpendMetric metric;
  final String? agentName;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final noPrice = metric == SpendMetric.cost && spend.unpriced;
    final caption = noPrice
        ? l10n.spendTokensNoPrice
        : metric == SpendMetric.cost
            ? (spend.estimatedCostUsd > 0
                ? l10n.spendCostEstimated
                : l10n.spendCostBilled)
            : l10n.spendTokensTotal;
    final facts = [
      l10n.spendResponses(
        spend.responses,
        NumberFormat.decimalPattern().format(spend.responses),
      ),
      if (metric == SpendMetric.cost && !noPrice)
        l10n.spendTokensInline(fmtTokens(spend.tokens))
      else if (spend.tokens > 0)
        l10n.spendCachedShare(
          (spend.cachedInputTokens / spend.tokens * 100).round(),
        ),
      if (metric == SpendMetric.cost && !noPrice && spend.unpricedTokens > 0)
        l10n.spendUnpriced(fmtTokens(spend.unpricedTokens)),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _measure(spend, metric),
          style: textTheme.displaySmall?.copyWith(
            fontWeight: FontWeight.w600,
            letterSpacing: -0.5,
          ),
        ),
        Text(
          agentName == null ? caption : '$agentName · $caption',
          style: textTheme.bodyMedium?.copyWith(color: colors.onSurfaceVariant),
        ),
        const SizedBox(height: UxnanSpacing.sm),
        Wrap(
          spacing: UxnanSpacing.md,
          runSpacing: UxnanSpacing.xs,
          children: [
            for (final fact in facts)
              Text(
                fact,
                style: textTheme.labelMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// The first, middle and last day under the chart.
class _Axis extends StatelessWidget {
  const _Axis({required this.days});

  final List<SpendDay> days;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final style = Theme.of(context)
        .textTheme
        .labelSmall
        ?.copyWith(color: colors.onSurfaceVariant);
    final format = DateFormat.MMMd();
    return Row(
      children: [
        Text(format.format(days.first.day), style: style),
        const Spacer(),
        Text(format.format(days[days.length ~/ 2].day), style: style),
        const Spacer(),
        Text(format.format(days.last.day), style: style),
      ],
    );
  }
}

/// The touched day: each agent's figure, and the day's total.
class _DayDetail extends StatelessWidget {
  const _DayDetail({
    required this.day,
    required this.agents,
    required this.metric,
  });

  final SpendDay day;
  final List<String> agents;
  final SpendMetric metric;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    String fmt(double v) =>
        metric == SpendMetric.cost ? fmtUsd(v) : fmtTokens(v);
    final present = [
      for (final id in agents)
        if ((day.byAgent[id] ?? 0) > 0) id,
    ];
    return Padding(
      padding: const EdgeInsets.only(top: UxnanSpacing.md),
      child: Container(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        decoration: BoxDecoration(
          color: colors.surfaceContainerHigh,
          borderRadius: const BorderRadius.all(UxnanRadius.lg),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              DateFormat.MMMMEEEEd().format(day.day),
              style: textTheme.labelLarge,
            ),
            const SizedBox(height: UxnanSpacing.xs),
            if (present.isEmpty)
              Text(
                l10n.spendNothingThatDay,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              )
            else
              for (final id in present)
                Padding(
                  padding: const EdgeInsets.symmetric(
                    vertical: UxnanSpacing.xs,
                  ),
                  child: Row(
                    children: [
                      _Swatch(color: SpendPalette.colorFor(id, colors)),
                      const SizedBox(width: UxnanSpacing.sm),
                      Expanded(
                        child: Text(_agentName(id), style: textTheme.bodySmall),
                      ),
                      Text(
                        fmt(day.byAgent[id]!),
                        style: textTheme.bodySmall?.copyWith(
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
                ),
            if (present.length > 1) ...[
              const Divider(height: UxnanSpacing.md),
              Row(
                children: [
                  Expanded(
                    child:
                        Text(l10n.spendDayTotal, style: textTheme.labelLarge),
                  ),
                  Text(fmt(day.total(agents)), style: textTheme.labelLarge),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// One agent in the legend: its colour and mark, its share and figure.
/// Touching it focuses the chart on it.
class _AgentRow extends StatelessWidget {
  const _AgentRow({
    required this.agent,
    required this.metric,
    required this.focused,
    required this.dimmed,
    required this.onTap,
  });

  /// How far the name sits from the row's leading edge — swatch, mark and
  /// the gaps between them — so the share rule underneath starts under it.
  static const double leadWidth = _Swatch.size +
      UxnanSpacing.sm +
      UxnanSize.iconContentSmall +
      UxnanSpacing.md;

  final SpendAgent agent;
  final SpendMetric metric;
  final bool focused;
  final bool dimmed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final color = SpendPalette.colorFor(agent.agentId, colors);
    final noPrice = metric == SpendMetric.cost && agent.spend.unpriced;
    final share = agent.share;
    final shareText = noPrice
        ? l10n.spendNoPrice
        : share > 0 && share < 0.01
            ? '<1%'
            : '${(share * 100).round()}%';
    return Semantics(
      button: true,
      selected: focused,
      child: InkWell(
        onTap: onTap,
        child: AnimatedOpacity(
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : UxnanMotion.swap,
          opacity: dimmed ? 0.45 : 1,
          child: Container(
            color: focused ? colors.secondaryContainer : null,
            padding: const EdgeInsets.symmetric(
              horizontal: UxnanSpacing.md,
              vertical: UxnanSpacing.sm,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    // The colour rides on the swatch, the same one the day
                    // detail and the models use; the mark stays bare, as agent
                    // marks do in rows.
                    _Swatch(color: color),
                    const SizedBox(width: UxnanSpacing.sm),
                    // Drawn at its default, [UxnanSize.iconContentSmall].
                    AgentLogo(
                      agent: AgentIdParsing.fromWireId(agent.agentId),
                      color: colors.onSurface,
                    ),
                    const SizedBox(width: UxnanSpacing.md),
                    Expanded(
                      child: Text(
                        _agentName(agent.agentId),
                        style: textTheme.titleSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(
                      shareText,
                      style: textTheme.labelMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(width: UxnanSpacing.md),
                    SizedBox(
                      width: 72,
                      child: Text(
                        _measure(agent.spend, metric),
                        textAlign: TextAlign.end,
                        style: textTheme.titleSmall?.copyWith(
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: UxnanSpacing.xs),
                // The share as a thin rule in the agent's colour: a second
                // reading of the same figure, never the only one.
                Padding(
                  padding: const EdgeInsets.only(left: _AgentRow.leadWidth),
                  child: ClipRRect(
                    borderRadius: const BorderRadius.all(UxnanRadius.full),
                    child: LinearProgressIndicator(
                      value: noPrice ? 0 : share.clamp(0.0, 1.0),
                      minHeight: 4,
                      color: color,
                      backgroundColor: colors.surfaceContainerHighest,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The top models of the period.
class _Models extends StatelessWidget {
  const _Models({required this.models});

  final List<SpendModel> models;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    if (models.isEmpty) return const SizedBox.shrink();
    return NeCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.spendTopModels,
            style: textTheme.labelLarge?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: UxnanSpacing.xs),
          for (final m in models)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
              child: Row(
                children: [
                  _Swatch(color: SpendPalette.colorFor(m.agentId, colors)),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(
                    child: Text(
                      m.model,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.bodyMedium,
                    ),
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Text(
                    fmtTokens(m.spend.tokens),
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                  SizedBox(
                    width: 72,
                    child: Text(
                      m.spend.unpriced
                          ? l10n.spendNoPrice
                          : fmtUsd(m.spend.costUsd),
                      textAlign: TextAlign.end,
                      style: textTheme.bodyMedium?.copyWith(
                        color:
                            m.spend.unpriced ? colors.onSurfaceVariant : null,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch({required this.color});

  /// The swatch's side.
  static const double size = 10;

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: color,
          borderRadius: const BorderRadius.all(Radius.circular(3)),
        ),
      );
}
