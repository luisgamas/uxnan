import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/spend_view.dart';
import 'package:uxnan/presentation/theme/spend_palette.dart';

/// A column per day, stacked by agent: what the agents spent over a period.
///
/// Thin marks laid out by [stackColumn] — every agent's segment visible, a
/// 2 dp gap between them, one rounded top per column whatever sits on it — a
/// recessive half-way gridline, and the agents stacked in their fixed order so
/// each keeps its colour ([SpendPalette]). Touching a column (or sliding across
/// them) selects its day — the others step back — and [onSelect] reports it;
/// touching the selected one again clears it.
class SpendChart extends StatelessWidget {
  /// Creates a [SpendChart].
  const SpendChart({
    required this.days,
    required this.agents,
    required this.onSelect,
    required this.semanticLabel,
    required this.formatValue,
    this.selected,
    this.height = 152,
    super.key,
  });

  /// Every day of the period, oldest first.
  final List<SpendDay> days;

  /// The agents to stack, bottom up.
  final List<String> agents;

  /// The selected day's index, if any.
  final int? selected;

  /// Called with the touched day's index, or null to clear.
  final ValueChanged<int?> onSelect;

  /// What the chart shows, for screen readers.
  final String semanticLabel;

  /// Formats the scale's top value (its only label).
  final String Function(double value) formatValue;

  /// The plot's height.
  final double height;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final peak = days.fold<double>(
      0,
      (m, d) => d.total(agents) > m ? d.total(agents) : m,
    );
    final ceiling = niceCeiling(peak);
    return Semantics(
      label: semanticLabel,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          int? indexAt(double dx) {
            if (days.isEmpty || width <= 0) return null;
            final i = (dx / width * days.length).floor();
            return i.clamp(0, days.length - 1);
          }

          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapUp: (details) {
              final i = indexAt(details.localPosition.dx);
              onSelect(i == selected ? null : i);
            },
            onHorizontalDragUpdate: (details) =>
                onSelect(indexAt(details.localPosition.dx)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                // The scale's top value, above its gridline: out of the
                // columns' way.
                Text(
                  formatValue(ceiling),
                  style: Theme.of(context)
                      .textTheme
                      .labelSmall
                      ?.copyWith(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 2),
                CustomPaint(
                  size: Size(width, height),
                  painter: _SpendChartPainter(
                    days: days,
                    agents: agents,
                    ceiling: ceiling,
                    selected: selected,
                    colorOf: (id) => SpendPalette.colorFor(id, scheme),
                    grid: scheme.outlineVariant.withValues(alpha: 0.6),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _SpendChartPainter extends CustomPainter {
  _SpendChartPainter({
    required this.days,
    required this.agents,
    required this.ceiling,
    required this.selected,
    required this.colorOf,
    required this.grid,
  });

  final List<SpendDay> days;
  final List<String> agents;
  final double ceiling;
  final int? selected;
  final Color Function(String agentId) colorOf;
  final Color grid;

  static const double _radius = 4;

  @override
  void paint(Canvas canvas, Size size) {
    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (final y in [0.5, size.height / 2, size.height - 0.5]) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }
    if (days.isEmpty) return;
    final slot = size.width / days.length;
    final barWidth = (slot * 0.64).clamp(2.0, 18.0);
    for (var i = 0; i < days.length; i++) {
      final day = days[i];
      final values = [for (final id in agents) day.byAgent[id] ?? 0.0];
      final layout = stackColumn(
        values,
        day.total(agents) / ceiling * size.height,
      );
      if (layout.segments.isEmpty) continue;
      final x = i * slot + (slot - barWidth) / 2;
      final dim = selected != null && selected != i;
      // The column is one shape: its rounded top clips whichever segments
      // reach it, so one agent or five end the same way.
      final column = Rect.fromLTRB(
        x,
        size.height - layout.height,
        x + barWidth,
        size.height,
      );
      final r = Radius.circular(
        [_radius, barWidth / 2, layout.height].reduce((a, b) => a < b ? a : b),
      );
      canvas
        ..save()
        ..clipRRect(RRect.fromRectAndCorners(column, topLeft: r, topRight: r));
      for (final segment in layout.segments) {
        canvas.drawRect(
          Rect.fromLTRB(
            x,
            size.height - segment.top,
            x + barWidth,
            size.height - segment.bottom,
          ),
          Paint()
            ..color = colorOf(agents[segment.index])
                .withValues(alpha: dim ? 0.32 : 1),
        );
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_SpendChartPainter old) =>
      old.days != days ||
      old.agents != agents ||
      old.ceiling != ceiling ||
      old.selected != selected ||
      old.grid != grid;
}

/// Where one agent's segment of a column sits: logical pixels up from the
/// baseline, and the agent's position in the values it came from.
@immutable
class ColumnSegment {
  /// Creates a [ColumnSegment].
  const ColumnSegment({
    required this.index,
    required this.bottom,
    required this.top,
  });

  /// The position of its value in what [stackColumn] was given.
  final int index;

  /// Its lower edge, up from the baseline.
  final double bottom;

  /// Its upper edge, up from the baseline.
  final double top;
}

/// One day's column: its height and its segments, bottom up.
@immutable
class ColumnLayout {
  /// Creates a [ColumnLayout].
  const ColumnLayout({required this.height, required this.segments});

  /// The column's height from the baseline.
  final double height;

  /// The non-empty values' segments, bottom up, in the order given.
  final List<ColumnSegment> segments;
}

/// The gap between two stacked segments and the least a segment is drawn at.
const double kSpendSegmentGap = 2;

/// The least height a segment of the spend chart is drawn at.
const double kSpendMinSegment = 2;

/// Lays out a column for [values] (one per agent, bottom up; zeros skipped)
/// whose total is drawn [height] tall — the same rule as the desktop's chart
/// (`uxnandesktop/src/lib/spendColumn.ts`), so a day reads alike on both.
///
/// Each segment keeps [kSpendMinSegment] and a [kSpendSegmentGap] to the next,
/// so a tiny share still shows its colour and never disappears into the gap.
/// What a small segment gains comes out of the largest ones, so the column's
/// height stays the day's total; only a column too short to hold every
/// segment it has grows to fit them.
ColumnLayout stackColumn(List<double> values, double height) {
  final present = [
    for (var i = 0; i < values.length; i++)
      if (values[i] > 0) i,
  ];
  if (present.isEmpty) return const ColumnLayout(height: 0, segments: []);
  final gaps = kSpendSegmentGap * (present.length - 1);
  final columnHeight = height > gaps + kSpendMinSegment * present.length
      ? height
      : gaps + kSpendMinSegment * present.length;
  final room = columnHeight - gaps;
  final total = present.fold<double>(0, (sum, i) => sum + values[i]);
  final sizes = [for (final i in present) values[i] / total * room];

  // Lift every segment below the minimum; take it from the largest ones,
  // never below the minimum themselves.
  var owed = 0.0;
  for (var i = 0; i < sizes.length; i++) {
    if (sizes[i] < kSpendMinSegment) {
      owed += kSpendMinSegment - sizes[i];
      sizes[i] = kSpendMinSegment;
    }
  }
  final byLargest = [for (var i = 0; i < sizes.length; i++) i]
    ..sort((a, b) => sizes[b].compareTo(sizes[a]));
  for (final i in byLargest) {
    if (owed <= 0) break;
    final spare = sizes[i] - kSpendMinSegment;
    final take = spare < owed ? spare : owed;
    sizes[i] -= take;
    owed -= take;
  }

  var bottom = 0.0;
  final segments = <ColumnSegment>[];
  for (var s = 0; s < present.length; s++) {
    final segment = ColumnSegment(
      index: present[s],
      bottom: bottom,
      top: bottom + sizes[s],
    );
    segments.add(segment);
    bottom = segment.top + kSpendSegmentGap;
  }
  return ColumnLayout(height: columnHeight, segments: segments);
}
