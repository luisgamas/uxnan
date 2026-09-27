import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/spend_view.dart';
import 'package:uxnan/presentation/theme/spend_palette.dart';

/// A column per day, stacked by agent: what the agents spent over a period.
///
/// Thin marks with a 2 dp gap between stacked segments and rounded tops, a
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
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
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

  static const double _gap = 2;
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
      final x = i * slot + (slot - barWidth) / 2;
      final present = [
        for (final id in agents)
          if ((day.byAgent[id] ?? 0) > 0) id,
      ];
      final dim = selected != null && selected != i;
      var base = 0.0;
      for (var s = 0; s < present.length; s++) {
        final value = day.byAgent[present[s]]!;
        final bottom = size.height - base / ceiling * size.height;
        base += value;
        final top = size.height - base / ceiling * size.height;
        // A 2 dp surface gap above the segment below.
        final segmentBottom = s == 0 ? bottom : bottom - _gap;
        if (segmentBottom - top < 0.5) continue;
        final rect = Rect.fromLTRB(x, top, x + barWidth, segmentBottom);
        final isTop = s == present.length - 1;
        final paint = Paint()
          ..color = colorOf(present[s]).withValues(alpha: dim ? 0.32 : 1);
        if (isTop) {
          final r = Radius.circular(
            [_radius, barWidth / 2, rect.height]
                .reduce((a, b) => a < b ? a : b),
          );
          canvas.drawRRect(
            RRect.fromRectAndCorners(rect, topLeft: r, topRight: r),
            paint,
          );
        } else {
          canvas.drawRect(rect, paint);
        }
      }
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
