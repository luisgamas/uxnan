import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Neural Expressive polygon **shape-morphing** loader (guide §4.7 / §6.6): a
/// small filled polygon that smoothly morphs through a sequence of shapes while
/// an agent produces its answer. Lightweight (a single [CustomPaint] inside a
/// [RepaintBoundary]); falls back to a static shape under reduced-motion.
///
/// The [shapes] list (vertex counts) must hold ≥ 2 entries — a single shape has
/// no transition to interpolate and would divide by zero.
class PolygonLoader extends StatefulWidget {
  /// Creates a [PolygonLoader].
  const PolygonLoader({
    this.size = 18,
    this.color,
    this.shapes = const [4, 3, 6, 8],
    this.cycle = const Duration(milliseconds: 900),
    super.key,
  }) : assert(shapes.length >= 2, 'shapes needs at least 2 figures');

  /// Width/height of the loader square, in logical pixels.
  final double size;

  /// Fill color; defaults to the theme `primary`.
  final Color? color;

  /// Vertex counts of the shapes to morph through, in order.
  final List<int> shapes;

  /// Duration of one shape-to-shape morph.
  final Duration cycle;

  @override
  State<PolygonLoader> createState() => _PolygonLoaderState();
}

class _PolygonLoaderState extends State<PolygonLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: widget.cycle);
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _controller
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) {
          setState(() => _index = (_index + 1) % widget.shapes.length);
          _controller.forward(from: 0);
        }
      })
      ..forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? Theme.of(context).colorScheme.primary;
    final reducedMotion = MediaQuery.of(context).disableAnimations;
    final next = (_index + 1) % widget.shapes.length;
    return RepaintBoundary(
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: reducedMotion
            ? CustomPaint(
                painter: _PolygonPainter(
                  sides: widget.shapes[_index],
                  nextSides: widget.shapes[_index],
                  t: 0,
                  color: color,
                ),
              )
            : AnimatedBuilder(
                animation: _controller,
                builder: (_, __) => CustomPaint(
                  painter: _PolygonPainter(
                    sides: widget.shapes[_index],
                    nextSides: widget.shapes[next],
                    t: _controller.value,
                    color: color,
                  ),
                ),
              ),
      ),
    );
  }
}

class _PolygonPainter extends CustomPainter {
  const _PolygonPainter({
    required this.sides,
    required this.nextSides,
    required this.t,
    required this.color,
  });

  final int sides;
  final int nextSides;
  final double t;
  final Color color;

  List<Offset> _vertices(int count, double radius, Offset center) {
    const start = -math.pi / 2;
    return List.generate(count, (i) {
      final angle = start + (2 * math.pi / count) * i;
      return Offset(
        center.dx + radius * math.cos(angle),
        center.dy + radius * math.sin(angle),
      );
    });
  }

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 * 0.92;
    final from = _vertices(sides, radius, center);
    final to = _vertices(nextSides, radius, center);
    final count = math.max(from.length, to.length);
    final path = Path();
    for (var i = 0; i < count; i++) {
      final a = from[i % from.length];
      final b = to[i % to.length];
      final point = Offset(a.dx + (b.dx - a.dx) * t, a.dy + (b.dy - a.dy) * t);
      if (i == 0) {
        path.moveTo(point.dx, point.dy);
      } else {
        path.lineTo(point.dx, point.dy);
      }
    }
    path.close();
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..isAntiAlias = true,
    );
  }

  @override
  bool shouldRepaint(_PolygonPainter old) =>
      old.sides != sides ||
      old.nextSides != nextSides ||
      old.t != t ||
      old.color != color;
}
