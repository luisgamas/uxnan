import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Strokes a dashed outline along a rounded rectangle, on top of [child].
///
/// Used to mark a bubble as *not yet handed over* without changing its fill:
/// a queued message reads as the same message it will be, drawn with an
/// unfinished edge, rather than as a different, greyed-out kind of thing.
///
/// The outline is painted as a foreground so it sits above the bubble's own
/// background, and it is purely decorative — nothing here affects layout or
/// hit-testing.
class NeDashedOutline extends StatelessWidget {
  /// Creates a dashed outline around [child].
  const NeDashedOutline({
    required this.color,
    required this.borderRadius,
    required this.child,
    this.strokeWidth = 1.5,
    this.dash = 5,
    this.gap = 4,
    super.key,
  });

  /// Stroke color of the dashes.
  final Color color;

  /// Corner radii, matched to the shape being outlined.
  final BorderRadius borderRadius;

  /// Thickness of the dashes.
  final double strokeWidth;

  /// Length of each dash.
  final double dash;

  /// Empty space between two dashes.
  final double gap;

  /// The widget the outline is drawn over.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      foregroundPainter: _DashedOutlinePainter(
        color: color,
        borderRadius: borderRadius,
        strokeWidth: strokeWidth,
        dash: dash,
        gap: gap,
      ),
      child: child,
    );
  }
}

class _DashedOutlinePainter extends CustomPainter {
  const _DashedOutlinePainter({
    required this.color,
    required this.borderRadius,
    required this.strokeWidth,
    required this.dash,
    required this.gap,
  });

  final Color color;
  final BorderRadius borderRadius;
  final double strokeWidth;
  final double dash;
  final double gap;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty || dash <= 0 || gap <= 0) return;
    // Inset by half the stroke so the dashes sit fully inside the bubble
    // instead of straddling its edge and looking a pixel too wide.
    final inset = strokeWidth / 2;
    final rect = Rect.fromLTWH(
      inset,
      inset,
      math.max(0, size.width - strokeWidth),
      math.max(0, size.height - strokeWidth),
    );
    if (rect.isEmpty) return;

    final path = Path()..addRRect(borderRadius.toRRect(rect));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        final end = math.min(distance + dash, metric.length);
        canvas.drawPath(metric.extractPath(distance, end), paint);
        distance = end + gap;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedOutlinePainter old) =>
      old.color != color ||
      old.borderRadius != borderRadius ||
      old.strokeWidth != strokeWidth ||
      old.dash != dash ||
      old.gap != gap;
}
