import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// A GitHub-style contribution heatmap: one cell per calendar day of [year],
/// laid out as 7 weekday rows × N week columns, colored by activity intensity.
///
/// Neural Expressive: a calm 5-step sequential ramp from `surfaceContainerHigh`
/// (empty) toward `primary` (busiest), composited so it reads correctly in both
/// light and dark. Intensity is quantized by quantile so a few very busy days
/// don't wash out the rest. Tapping a cell reveals that day in the caption;
/// the grid scrolls horizontally inside its own box so the page never does.
///
/// Data-only: the parent owns the metric/year selectors and passes the day
/// counts for the chosen scope via [countsByDay] (keyed by local midnight).
class ActivityHeatmap extends StatefulWidget {
  /// Creates an [ActivityHeatmap].
  const ActivityHeatmap({
    required this.year,
    required this.countsByDay,
    super.key,
  });

  /// The calendar year the grid renders.
  final int year;

  /// Activity count per local day (days with no activity may be absent).
  final Map<DateTime, int> countsByDay;

  @override
  State<ActivityHeatmap> createState() => _ActivityHeatmapState();
}

class _ActivityHeatmapState extends State<ActivityHeatmap> {
  static const double _cell = 13;
  static const double _gap = 3;

  DateTime? _selected;

  @override
  void didUpdateWidget(ActivityHeatmap oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The metric/year changed underneath us — a stale selected day no longer
    // maps to what's shown, so clear it.
    if (oldWidget.year != widget.year ||
        oldWidget.countsByDay != widget.countsByDay) {
      _selected = null;
    }
  }

  /// The activity count for [day] (0 when absent).
  int _countFor(DateTime day) =>
      widget.countsByDay[DateTime(day.year, day.month, day.day)] ?? 0;

  /// Quantile thresholds [t1, t2, t3] mapping a positive count to levels 2–4
  /// (level 1 is "≥ 1"). Derived from the positive counts so the ramp adapts to
  /// the data instead of a fixed scale a few busy days would saturate.
  List<int> _thresholds() {
    final positive = widget.countsByDay.values.where((v) => v > 0).toList()
      ..sort();
    if (positive.isEmpty) return const [2, 3, 4];
    int q(double p) => positive[(p * (positive.length - 1)).round()];
    final t1 = q(0.5) < 2 ? 2 : q(0.5);
    final t2 = q(0.8) <= t1 ? t1 + 1 : q(0.8);
    final t3 = q(0.95) <= t2 ? t2 + 1 : q(0.95);
    return [t1, t2, t3];
  }

  int _level(int count, List<int> t) {
    if (count <= 0) return 0;
    if (count < t[0]) return 1;
    if (count < t[1]) return 2;
    if (count < t[2]) return 3;
    return 4;
  }

  Color _colorForLevel(int level, ColorScheme colors) {
    if (level == 0) return colors.surfaceContainerHigh;
    const alphas = [0.28, 0.5, 0.72, 1.0];
    return Color.alphaBlend(
      colors.primary.withValues(alpha: alphas[level - 1]),
      colors.surfaceContainerHigh,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    // Iterate the year in UTC to stay DST-proof; key cells by their plain
    // (y,m,d) so they match the local-midnight keys in [countsByDay].
    final firstUtc = DateTime.utc(widget.year);
    final lastUtc = DateTime.utc(widget.year, 12, 31);
    final gridStart = firstUtc.subtract(Duration(days: firstUtc.weekday - 1));
    final weekCount = lastUtc.difference(gridStart).inDays ~/ 7 + 1;
    final thresholds = _thresholds();

    var total = 0;
    var activeDays = 0;
    for (final v in widget.countsByDay.values) {
      if (v > 0) {
        total += v;
        activeDays++;
      }
    }

    final weeks = <Widget>[];
    for (var w = 0; w < weekCount; w++) {
      final cells = <Widget>[];
      for (var d = 0; d < 7; d++) {
        final utcDay = gridStart.add(Duration(days: w * 7 + d));
        final inYear = !utcDay.isBefore(firstUtc) && !utcDay.isAfter(lastUtc);
        if (!inYear) {
          cells.add(const SizedBox(width: _cell, height: _cell));
        } else {
          final day = DateTime(utcDay.year, utcDay.month, utcDay.day);
          final count = _countFor(day);
          final selected = _selected == day;
          cells.add(
            _HeatCell(
              color: _colorForLevel(_level(count, thresholds), colors),
              selected: selected,
              ringColor: colors.primary,
              onTap: () => setState(() => _selected = selected ? null : day),
            ),
          );
        }
        if (d < 6) cells.add(const SizedBox(height: _gap));
      }
      weeks.add(Column(mainAxisSize: MainAxisSize.min, children: cells));
      if (w < weekCount - 1) weeks.add(const SizedBox(width: _gap));
    }

    return GestureDetector(
      // Tapping anywhere on the heatmap that isn't a day cell (the legend,
      // caption, gaps or padding) clears the current day selection, so the user
      // never has to switch views to reset it.
      behavior: HitTestBehavior.translucent,
      onTap: () {
        if (_selected != null) setState(() => _selected = null);
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            reverse: true, // open on the most recent weeks (like GitHub)
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
              child: Row(mainAxisSize: MainAxisSize.min, children: weeks),
            ),
          ),
          const SizedBox(height: UxnanSpacing.xs),
          _Legend(
            less: l10n.profileActivityLess,
            more: l10n.profileActivityMore,
            swatch: (level) => _colorForLevel(level, colors),
          ),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            _selected != null
                ? l10n.profileHeatmapDay(
                    DateFormat.MMMMd().format(_selected!),
                    _countFor(_selected!),
                  )
                : l10n.profileHeatmapSummary(total, activeDays),
            style:
                textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _HeatCell extends StatelessWidget {
  const _HeatCell({
    required this.color,
    required this.selected,
    required this.ringColor,
    required this.onTap,
  });

  final Color color;
  final bool selected;
  final Color ringColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 13,
        height: 13,
        decoration: BoxDecoration(
          color: color,
          borderRadius: const BorderRadius.all(UxnanRadius.sm),
          border: selected
              ? Border.all(color: ringColor, width: 1.5)
              : Border.all(color: Colors.transparent, width: 1.5),
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({
    required this.less,
    required this.more,
    required this.swatch,
  });

  final String less;
  final String more;
  final Color Function(int level) swatch;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final label = UxnanTypography.bodySmall.copyWith(
      color: colors.onSurfaceVariant,
      fontSize: 11,
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(less, style: label),
        const SizedBox(width: UxnanSpacing.xs),
        for (var level = 0; level <= 4; level++) ...[
          Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(
              color: swatch(level),
              borderRadius: const BorderRadius.all(UxnanRadius.sm),
            ),
          ),
          if (level < 4) const SizedBox(width: 3),
        ],
        const SizedBox(width: UxnanSpacing.xs),
        Text(more, style: label),
      ],
    );
  }
}
