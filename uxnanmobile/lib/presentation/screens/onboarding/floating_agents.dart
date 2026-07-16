import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:uxnan/presentation/widgets/agent_logo_chip.dart';

/// Where a single floating logo sits (align) and how big it is (size).
typedef AgentPlacement = ({Alignment align, double size});

/// A small cluster of 2–3 agent logos scattered across a top band, gently
/// floating up and down. Each onboarding page passes a different placements
/// preset so the logos vary in size and position from screen to screen.
///
/// Efficient by design: a single [AnimationController] drives all chips, each
/// chip translates on the GPU via [Transform.translate], and each is wrapped in
/// a [RepaintBoundary] so only the small logo subtrees repaint per frame.
class FloatingAgents extends StatefulWidget {
  /// Creates a FloatingAgents cluster pairing assets with placements.
  const FloatingAgents({
    required this.assets,
    required this.placements,
    super.key,
  });

  /// Agent logo asset paths (see `AgentLogos`).
  final List<String> assets;

  /// Per-logo position and size; zipped with assets (uses the shorter length).
  final List<AgentPlacement> placements;

  /// Layout preset: wide top corners, one low center.
  static const List<AgentPlacement> layoutA = [
    (align: Alignment(-0.72, -0.12), size: 64.0),
    (align: Alignment(0.70, -0.74), size: 46.0),
    (align: Alignment(0.18, 0.74), size: 42.0),
  ];

  /// Layout preset — high-left, mid-right, low-center.
  static const List<AgentPlacement> layoutB = [
    (align: Alignment(-0.55, -0.70), size: 50.0),
    (align: Alignment(0.66, -0.05), size: 62.0),
    (align: Alignment(-0.20, 0.68), size: 44.0),
  ];

  /// Layout preset — left-mid, high-center, low-right.
  static const List<AgentPlacement> layoutC = [
    (align: Alignment(-0.78, -0.48), size: 48.0),
    (align: Alignment(0.48, -0.78), size: 58.0),
    (align: Alignment(0.80, 0.30), size: 52.0),
  ];

  /// Layout preset — diagonal sweep.
  static const List<AgentPlacement> layoutD = [
    (align: Alignment(-0.62, -0.55), size: 56.0),
    (align: Alignment(0.72, -0.18), size: 44.0),
    (align: Alignment(0.04, -0.88), size: 60.0),
  ];

  @override
  State<FloatingAgents> createState() => _FloatingAgentsState();
}

class _FloatingAgentsState extends State<FloatingAgents>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 6),
  )..repeat();

  static const double _amplitude = 6;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final count = math.min(widget.assets.length, widget.placements.length);
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return SizedBox(
      height: 150,
      width: double.infinity,
      child: Stack(
        children: [
          for (var i = 0; i < count; i++)
            Align(
              alignment: widget.placements[i].align,
              child: RepaintBoundary(
                child: AnimatedBuilder(
                  animation: _controller,
                  child: AgentLogoChip(
                    asset: widget.assets[i],
                    size: widget.placements[i].size,
                  ),
                  builder: (context, child) {
                    final dy = reduceMotion
                        ? 0.0
                        : _amplitude *
                            math.sin(
                              _controller.value * 2 * math.pi + i * 2.1,
                            );
                    return Transform.translate(
                      offset: Offset(0, dy),
                      child: child,
                    );
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}
