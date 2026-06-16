import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/motion.dart';

/// Neural Expressive **Icon Surface**: a circular 40 dp action on a neutral
/// `surfaceContainerHigh` surface with a 48 dp touch target, for app-bar and
/// drawer actions over transparent chrome (guide §4.2). Press feedback uses the
/// M3E `spatialFast` spring (scale 1.0 → 0.92).
class IconSurface extends StatefulWidget {
  /// Creates an [IconSurface].
  const IconSurface({
    required this.icon,
    required this.tooltip,
    this.onPressed,
    this.selected = false,
    this.background,
    this.foreground,
    super.key,
  });

  /// The glyph shown at 20 dp.
  final IconData icon;

  /// Tooltip + accessibility semantic label (required for icon-only buttons).
  final String tooltip;

  /// Tap handler; when null the surface reads as disabled.
  final VoidCallback? onPressed;

  /// When true, uses the selected (secondary-container) tone.
  final bool selected;

  /// Optional background override (defaults to the neutral surface tone).
  final Color? background;

  /// Optional foreground override.
  final Color? foreground;

  @override
  State<IconSurface> createState() => _IconSurfaceState();
}

class _IconSurfaceState extends State<IconSurface>
    with SingleTickerProviderStateMixin {
  late final AnimationController _scale =
      AnimationController.unbounded(vsync: this, value: 1);

  @override
  void dispose() {
    _scale.dispose();
    super.dispose();
  }

  void _press() => _scale.animateWithSpring(0.92, M3ESprings.spatialFast);
  void _release() => _scale.animateWithSpring(1, M3ESprings.spatialFast);

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final enabled = widget.onPressed != null;
    final background = widget.selected
        ? (widget.background ?? colors.secondaryContainer)
        : (widget.background ?? colors.surfaceContainerHigh);
    final foreground = widget.selected
        ? (widget.foreground ?? colors.onSecondaryContainer)
        : (widget.foreground ?? colors.onSurfaceVariant);

    return Tooltip(
      message: widget.tooltip,
      child: GestureDetector(
        onTapDown: enabled ? (_) => _press() : null,
        onTapUp: enabled ? (_) => _release() : null,
        onTapCancel: enabled ? _release : null,
        child: ScaleTransition(
          scale: _scale,
          // 48×48 dp touch target wrapping a 40 dp visual circle (a11y).
          child: SizedBox(
            width: 48,
            height: 48,
            child: Center(
              child: Material(
                color: background,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: widget.onPressed,
                  child: SizedBox(
                    width: 40,
                    height: 40,
                    child: Icon(
                      widget.icon,
                      size: 20,
                      semanticLabel: widget.tooltip,
                      color: enabled
                          ? foreground
                          : colors.onSurfaceVariant.withValues(alpha: 0.38),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
