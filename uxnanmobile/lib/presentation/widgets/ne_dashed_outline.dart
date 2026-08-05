import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';

/// A rounded border stroked with dashes, for a bubble that is *not yet handed
/// over*.
///
/// A queued message reads as the same message it will be, drawn with an
/// unfinished edge, rather than as a different, greyed-out kind of thing.
///
/// This is a [ShapeBorder], not a widget painting over one, and that is the
/// whole point: an overlay is drawn around whatever box it wraps — including
/// that box's margin — so it floated a few pixels off the bubble and read as a
/// second rectangle sitting on top. As a border it belongs to the bubble's own
/// decoration, so it is stroked on exactly the shape being filled, and it
/// animates with the rest of the decoration instead of independently.
class NeDashedBorder extends OutlinedBorder {
  /// Creates a dashed rounded border.
  const NeDashedBorder({
    required this.borderRadius,
    super.side = const BorderSide(width: 1.5),
    this.dash = 5,
    this.gap = 4,
  });

  /// Corner radii — the same ones the bubble is filled with.
  final BorderRadius borderRadius;

  /// Length of each dash.
  final double dash;

  /// Empty space between two dashes.
  final double gap;

  @override
  EdgeInsetsGeometry get dimensions => EdgeInsets.all(side.strokeInset);

  @override
  ShapeBorder scale(double t) => NeDashedBorder(
        borderRadius: borderRadius * t,
        side: side.scale(t),
        dash: dash * t,
        gap: gap * t,
      );

  @override
  NeDashedBorder copyWith({
    BorderSide? side,
    BorderRadius? borderRadius,
    double? dash,
    double? gap,
  }) =>
      NeDashedBorder(
        borderRadius: borderRadius ?? this.borderRadius,
        side: side ?? this.side,
        dash: dash ?? this.dash,
        gap: gap ?? this.gap,
      );

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) =>
      Path()..addRRect(borderRadius.toRRect(rect).deflate(side.strokeInset));

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) =>
      Path()..addRRect(borderRadius.toRRect(rect));

  @override
  ShapeBorder? lerpFrom(ShapeBorder? a, double t) {
    if (a is NeDashedBorder) {
      return NeDashedBorder(
        borderRadius: BorderRadius.lerp(a.borderRadius, borderRadius, t)!,
        side: BorderSide.lerp(a.side, side, t),
        dash: lerpDouble(a.dash, dash, t)!,
        gap: lerpDouble(a.gap, gap, t)!,
      );
    }
    return super.lerpFrom(a, t);
  }

  @override
  ShapeBorder? lerpTo(ShapeBorder? b, double t) {
    if (b is NeDashedBorder) return b.lerpFrom(this, t);
    return super.lerpTo(b, t);
  }

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    if (side.style == BorderStyle.none || rect.isEmpty) return;
    if (dash <= 0 || gap <= 0) return;

    // Inset by half the stroke so the dashes sit fully inside the bubble
    // instead of straddling its edge and looking a pixel too wide.
    final inset = side.width / 2;
    final inner = Rect.fromLTWH(
      rect.left + inset,
      rect.top + inset,
      math.max(0, rect.width - side.width),
      math.max(0, rect.height - side.width),
    );
    if (inner.isEmpty) return;

    final path = Path()..addRRect(borderRadius.toRRect(inner));
    final paint = side.toPaint()..strokeCap = StrokeCap.round;

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
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is NeDashedBorder &&
          other.borderRadius == borderRadius &&
          other.side == side &&
          other.dash == dash &&
          other.gap == gap;

  @override
  int get hashCode => Object.hash(borderRadius, side, dash, gap);
}
