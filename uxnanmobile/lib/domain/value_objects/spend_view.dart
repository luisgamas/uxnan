import 'package:uxnan/domain/value_objects/usage_summary.dart';

/// What the spend chart and its totals measure.
enum SpendMetric {
  /// Dollars: billed where recorded, else estimated at API prices.
  cost,

  /// Every token read or written.
  tokens,
}

/// The periods the spend view offers, in days.
const List<int> kSpendPeriods = [7, 30, 90];

/// The agents in the fixed order their chart colours are assigned in: a colour
/// belongs to the agent, never to its rank, and a stack follows this order so
/// neighbouring colours are always the pairs the palette was checked for.
const List<String> kSpendAgentOrder = [
  'codex',
  'claude-code',
  'opencode',
  'grok',
  'pi-agent',
  'antigravity-cli',
  'zero',
];

/// One day of the period: each agent's value in the chosen metric.
class SpendDay {
  /// Creates a [SpendDay].
  const SpendDay({required this.day, required this.byAgent});

  /// The calendar day (local midnight).
  final DateTime day;

  /// Value per agent id.
  final Map<String, double> byAgent;

  /// The day's total over [agents] (every agent when null).
  double total([Iterable<String>? agents]) {
    if (agents == null) return byAgent.values.fold(0, (a, b) => a + b);
    return agents.fold(0, (sum, id) => sum + (byAgent[id] ?? 0));
  }
}

/// One agent over the period.
class SpendAgent {
  /// Creates a [SpendAgent].
  const SpendAgent({
    required this.agentId,
    required this.spend,
    required this.share,
  });

  /// Wire agent id.
  final String agentId;

  /// What it spent.
  final UsageSpend spend;

  /// Its share of the period's total in the chosen metric, 0–1.
  final double share;
}

/// One model over the period.
class SpendModel {
  /// Creates a [SpendModel].
  const SpendModel({
    required this.agentId,
    required this.model,
    required this.spend,
  });

  /// The agent that ran it.
  final String agentId;

  /// The model, as the CLI names it.
  final String model;

  /// What it spent.
  final UsageSpend spend;
}

/// A period's spend, shaped for the chart, the legend and the models list.
class SpendView {
  /// Creates a [SpendView].
  const SpendView({
    required this.days,
    required this.agents,
    required this.models,
    required this.total,
  });

  /// Every day of the period (spent or not), oldest first.
  final List<SpendDay> days;

  /// Agents with spend, in [kSpendAgentOrder] order.
  final List<SpendAgent> agents;

  /// Models, most spent first.
  final List<SpendModel> models;

  /// The period's total.
  final UsageSpend total;

  /// Whether nothing was spent.
  bool get isEmpty => agents.isEmpty;

  /// The largest day total over [agents] (every agent when null).
  double peak([Iterable<String>? agents]) =>
      days.fold(0, (m, d) => d.total(agents) > m ? d.total(agents) : m);
}

/// The value of [spend] in [metric].
double spendValue(UsageSpend spend, SpendMetric metric) =>
    metric == SpendMetric.cost ? spend.costUsd : spend.tokens.toDouble();

/// The [days] calendar days ending on [today], oldest first.
List<DateTime> periodDays(int days, DateTime today) {
  final end = DateTime(today.year, today.month, today.day);
  return [
    for (var i = days - 1; i >= 0; i--)
      DateTime(end.year, end.month, end.day - i),
  ];
}

String _dayKey(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}'
    '-${d.day.toString().padLeft(2, '0')}';

/// The spend of [summaries] (one PC, or every PC) over the last [days] days.
///
/// Each PC dates its spend by its own local day; merging PCs adds the same
/// dates together. The bridge never reports the development echo agent, and
/// neither does this.
SpendView computeSpendView(
  Iterable<UsageSummary> summaries,
  int days,
  SpendMetric metric, {
  DateTime? today,
}) {
  final keys = periodDays(days, today ?? DateTime.now());
  final index = {for (final d in keys) _dayKey(d): d};
  final byDay = <String, Map<String, double>>{};
  final perAgent = <String, UsageSpend>{};
  final perModel = <String, SpendModel>{};
  var total = const UsageSpend();
  for (final summary in summaries) {
    for (final day in summary.days) {
      if (!index.containsKey(day.day)) continue;
      final values = byDay.putIfAbsent(day.day, () => {});
      for (final bucket in day.buckets) {
        if (bucket.agentId == 'echo') continue;
        values[bucket.agentId] =
            (values[bucket.agentId] ?? 0) + spendValue(bucket.spend, metric);
        total += bucket.spend;
        perAgent[bucket.agentId] =
            (perAgent[bucket.agentId] ?? const UsageSpend()) + bucket.spend;
        final key = '${bucket.agentId}\t${bucket.model}';
        final model = perModel[key];
        perModel[key] = SpendModel(
          agentId: bucket.agentId,
          model: bucket.model,
          spend: (model?.spend ?? const UsageSpend()) + bucket.spend,
        );
      }
    }
  }
  final grand = spendValue(total, metric);
  int order(String id) {
    final at = kSpendAgentOrder.indexOf(id);
    return at == -1 ? kSpendAgentOrder.length : at;
  }

  final agents = [
    for (final entry in perAgent.entries)
      SpendAgent(
        agentId: entry.key,
        spend: entry.value,
        share: grand > 0 ? spendValue(entry.value, metric) / grand : 0,
      ),
  ]..sort((a, b) {
      final byOrder = order(a.agentId).compareTo(order(b.agentId));
      return byOrder != 0 ? byOrder : a.agentId.compareTo(b.agentId);
    });
  final models = perModel.values.toList()
    ..sort((a, b) {
      final byValue =
          spendValue(b.spend, metric).compareTo(spendValue(a.spend, metric));
      return byValue != 0 ? byValue : b.spend.tokens.compareTo(a.spend.tokens);
    });
  return SpendView(
    days: [
      for (final entry in index.entries)
        SpendDay(day: entry.value, byAgent: byDay[entry.key] ?? const {}),
    ],
    agents: agents,
    models: models,
    total: total,
  );
}

/// A round scale ceiling at or above [peak], close enough that the tallest
/// column fills most of the plot (steps of 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 per
/// power of ten).
double niceCeiling(double peak) {
  if (peak <= 0) return 1;
  var base = 1.0;
  while (base * 10 <= peak) {
    base *= 10;
  }
  while (base > peak) {
    base /= 10;
  }
  for (final m in const [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0]) {
    if (m * base >= peak) return m * base;
  }
  return 10 * base;
}
