import 'dart:async';

import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/motion.dart';

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
    this.duration = UxnanMotion.reveal,
    this.delay = Duration.zero,
    this.offset = 12,
    super.key,
  });

  /// The widget to reveal.
  final Widget child;

  /// How long the entrance takes.
  final Duration duration;

  /// How long to wait before starting — how a list staggers.
  ///
  /// The child is **not drawn** while it waits, so a staggered row does not
  /// flash at full opacity before its turn.
  final Duration delay;

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

  Timer? _start;

  @override
  void initState() {
    super.initState();
    if (widget.delay == Duration.zero) {
      _controller.forward();
    } else {
      _start = Timer(widget.delay, () {
        if (mounted) _controller.forward();
      });
    }
  }

  @override
  void dispose() {
    _start?.cancel();
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
      // The SHAPE of this subtree never changes — not while animating, not
      // once finished. Returning the bare child on completion (as this used
      // to) swaps two widgets out from above it, so Flutter unmounts the
      // child's element and rebuilds it: any State it held is destroyed the
      // moment the entrance ends. A settled `Opacity(1)` costs nothing —
      // it skips its layer — and this widget stops rebuilding anyway once the
      // controller stops ticking.
      builder: (context, child) => Opacity(
        opacity: _fade.value,
        child: Transform.translate(
          offset: Offset(0, (1 - _fade.value) * widget.offset),
          child: child,
        ),
      ),
    );
  }
}
