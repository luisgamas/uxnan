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

/// An [IconSurface] that opens an M3 popup menu. Use instead of a
/// [PopupMenuButton] with a circular child: that wraps its child in a
/// **rectangular** [InkWell], so the press ripple reads as a square over the
/// round surface. This drives [showMenu] from an [IconSurface] tap instead, so
/// the ripple is clipped to the circle (and the M3E press-scale spring plays),
/// staying coherent with the standalone bar actions.
class IconSurfaceMenu<T> extends StatelessWidget {
  /// Creates an [IconSurfaceMenu].
  const IconSurfaceMenu({
    required this.icon,
    required this.tooltip,
    required this.itemBuilder,
    this.onSelected,
    this.enabled = true,
    this.constraints,
    super.key,
  });

  /// The glyph shown on the surface.
  final IconData icon;

  /// Tooltip + accessibility label.
  final String tooltip;

  /// Builds the menu entries (same contract as [PopupMenuButton.itemBuilder]).
  final PopupMenuItemBuilder<T> itemBuilder;

  /// Called with the chosen value. Optional — entries may instead carry their
  /// own `onTap` (the `void`-typed menus do).
  final PopupMenuItemSelected<T>? onSelected;

  /// When false the surface reads as disabled and won't open.
  final bool enabled;

  /// Optional size constraints for the menu (e.g. a wider `minWidth`).
  final BoxConstraints? constraints;

  Future<void> _open(BuildContext context) async {
    final button = context.findRenderObject()! as RenderBox;
    final overlay =
        Navigator.of(context).overlay!.context.findRenderObject()! as RenderBox;
    final bottomLeft = button.localToGlobal(
      button.size.bottomLeft(Offset.zero),
      ancestor: overlay,
    );
    final bottomRight = button.localToGlobal(
      button.size.bottomRight(Offset.zero),
      ancestor: overlay,
    );
    // A zero-height anchor at the button's bottom edge → menu opens under it,
    // matching PopupMenuPosition.under.
    final position = RelativeRect.fromRect(
      Rect.fromPoints(bottomLeft, bottomRight),
      Offset.zero & overlay.size,
    );
    final items = itemBuilder(context);
    if (items.isEmpty) return;
    final selected = await showMenu<T>(
      context: context,
      position: position,
      items: items,
      constraints: constraints,
    );
    if (selected != null) onSelected?.call(selected);
  }

  @override
  Widget build(BuildContext context) {
    return IconSurface(
      icon: icon,
      tooltip: tooltip,
      onPressed: enabled ? () => _open(context) : null,
    );
  }
}
