import 'package:flutter/material.dart';

/// Fades and lifts its child into place the first time it is built.
///
/// Timeline entries currently pop in at full opacity the instant a message is
/// persisted, which reads as a jump rather than as something arriving. This
/// plays the Material "enter" pattern once per widget — a short fade with a
/// small upward slide — and then gets out of the way entirely: after the
/// animation completes it is a plain pass-through, so scrolling a long thread
/// costs nothing.
///
/// Honors `MediaQuery.disableAnimations`, in which case the child simply
/// appears.
class NeEnterTransition extends StatefulWidget {
  /// Creates a [NeEnterTransition].
  const NeEnterTransition({
    required this.child,
    this.duration = const Duration(milliseconds: 260),
    this.offset = 12,
    super.key,
  });

  /// The widget to reveal.
  final Widget child;

  /// How long the entrance takes.
  final Duration duration;

  /// How far below its resting place the child starts, in logical pixels.
  final double offset;

  @override
  State<NeEnterTransition> createState() => _NeEnterTransitionState();
}

class _NeEnterTransitionState extends State<NeEnterTransition>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: widget.duration,
  );

  late final Animation<double> _fade = CurvedAnimation(
    parent: _controller,
    // Material's emphasized-decelerate: quick to become visible, unhurried as
    // it settles.
    curve: Curves.easeOutCubic,
  );

  @override
  void initState() {
    super.initState();
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return widget.child;
    return AnimatedBuilder(
      animation: _fade,
      // Built once and reused: the child does not depend on the animation, so
      // rebuilding it every frame would be pure waste.
      child: widget.child,
      builder: (context, child) {
        if (_controller.isCompleted) return child!;
        return Opacity(
          opacity: _fade.value,
          child: Transform.translate(
            offset: Offset(0, (1 - _fade.value) * widget.offset),
            child: child,
          ),
        );
      },
    );
  }
}
