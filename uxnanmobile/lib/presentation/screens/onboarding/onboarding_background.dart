import 'package:flutter/material.dart';

/// Decorative onboarding backdrop: a soft square grid over the surface color,
/// covered by a top-transparent → bottom-surface gradient so the grid is
/// visible up top and fades cleanly into the background behind the controls.
class OnboardingBackground extends StatelessWidget {
  /// Creates an [OnboardingBackground].
  const OnboardingBackground({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    // A shade deeper than the surface, for extra depth at the very bottom.
    final deep = Color.lerp(colors.surface, Colors.black, 0.45)!;

    return DecoratedBox(
      decoration: BoxDecoration(color: colors.surface),
      child: Stack(
        fit: StackFit.expand,
        children: [
          RepaintBoundary(
            child: CustomPaint(
              painter: _GridPainter(
                color: colors.outline.withValues(alpha: 0.55),
              ),
            ),
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  Colors.transparent,
                  colors.surface,
                  deep,
                ],
                stops: [0.0, 0.38, 0.82, 1.0],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GridPainter extends CustomPainter {
  _GridPainter({required this.color});

  final Color color;

  /// Side length of each grid square, in logical pixels.
  static const double cell = 28;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    for (var x = 0.0; x <= size.width; x += cell) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (var y = 0.0; y <= size.height; y += cell) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(_GridPainter oldDelegate) => oldDelegate.color != color;
}
