import 'package:flutter/material.dart';

/// Neural Expressive **circular action button** — a filled
/// `secondaryContainer` circle with a single glyph, used for the floating
/// scroll shortcuts (scroll-to-bottom in the conversation, back-to-top in the
/// git history). NE's action language is circular (like `IconSurface`), so this
/// replaces M3's default rounded-square `FloatingActionButton.small` to keep
/// every floating action consistent across the app.
class NeCircularButton extends StatelessWidget {
  /// Creates a [NeCircularButton].
  const NeCircularButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.size = 44,
    this.iconSize = 26,
    super.key,
  });

  /// The glyph shown centered in the circle.
  final IconData icon;

  /// Tooltip + accessibility label.
  final String tooltip;

  /// Tap handler.
  final VoidCallback onTap;

  /// Diameter of the circle.
  final double size;

  /// Glyph size.
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: colors.secondaryContainer,
        shape: const CircleBorder(),
        elevation: 3,
        shadowColor: colors.shadow,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: size,
            height: size,
            child: Icon(
              icon,
              color: colors.onSecondaryContainer,
              size: iconSize,
            ),
          ),
        ),
      ),
    );
  }
}
