import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/motion.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Shared line above the composer.
///
/// Persistent turn controls stay left while diff/context indicators remain
/// anchored right in the default folded state. Expanding the turn controls
/// smoothly yields the full compact-screen width by moving the informational
/// chrome out of view; folding the controls restores it.
class ComposerContextBar extends StatelessWidget {
  /// Creates the composer context bar.
  const ComposerContextBar({
    required this.controlsExpanded,
    this.controls,
    this.info,
    super.key,
  });

  /// Whether the leading turn-control shelf is expanded.
  final bool controlsExpanded;

  /// Persistent turn controls placed at the leading edge.
  final Widget? controls;

  /// Read-only diff/context indicators placed at the trailing edge.
  final Widget? info;

  @override
  Widget build(BuildContext context) {
    final controls = this.controls;
    final info = this.info;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        0,
      ),
      child: Row(
        children: [
          if (controls != null) Expanded(child: controls),
          if (info != null)
            _TrailingInfoVisibility(
              visible: controls == null || !controlsExpanded,
              child: Padding(
                padding: EdgeInsets.only(
                  left: controls == null ? 0 : UxnanSpacing.sm,
                ),
                child: info,
              ),
            ),
        ],
      ),
    );
  }
}

/// A horizontal M3E hand-off that frees layout width while fading and sliding.
class _TrailingInfoVisibility extends StatefulWidget {
  const _TrailingInfoVisibility({
    required this.visible,
    required this.child,
  });

  final bool visible;
  final Widget child;

  @override
  State<_TrailingInfoVisibility> createState() =>
      _TrailingInfoVisibilityState();
}

class _TrailingInfoVisibilityState extends State<_TrailingInfoVisibility>
    with SingleTickerProviderStateMixin {
  late final AnimationController _progress = AnimationController.unbounded(
    vsync: this,
    value: widget.visible ? 1 : 0,
  );

  bool? _reduceMotion;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (_reduceMotion == reduceMotion) return;
    _reduceMotion = reduceMotion;
    _animateToVisibility();
  }

  @override
  void didUpdateWidget(covariant _TrailingInfoVisibility oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.visible != widget.visible) _animateToVisibility();
  }

  void _animateToVisibility() {
    final target = widget.visible ? 1.0 : 0.0;
    if (_reduceMotion ?? false) {
      _progress.value = target;
      return;
    }
    _progress.animateWithSpring(target, M3ESprings.spatialFast);
  }

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _progress,
      child: ExcludeSemantics(
        excluding: !widget.visible,
        child: IgnorePointer(
          ignoring: !widget.visible,
          child: widget.child,
        ),
      ),
      builder: (context, child) {
        final progress = _progress.value.clamp(0.0, 1.0);
        return ClipRect(
          key: const ValueKey('composer-context-info-transition'),
          child: Align(
            alignment: Alignment.centerRight,
            widthFactor: progress,
            child: Opacity(
              opacity: progress,
              child: Transform.translate(
                offset: Offset(
                  (1 - progress) * UxnanSpacing.sm,
                  0,
                ),
                child: child,
              ),
            ),
          ),
        );
      },
    );
  }
}
