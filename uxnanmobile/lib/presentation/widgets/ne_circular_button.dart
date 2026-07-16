import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Neural Expressive **circular action button** — a neutral floating surface
/// with a single glyph, used for the floating
/// scroll shortcuts (scroll-to-bottom in the conversation, back-to-top in the
/// git history). NE's action language is circular (like `IconSurface`), so this
/// replaces M3's default rounded-square `FloatingActionButton.small` to keep
/// every floating action consistent across the app. Its 52 dp footprint is
/// deliberately easier to acquire than the old 44 dp control without becoming
/// as visually dominant as a primary 56 dp FAB.
class NeCircularButton extends StatelessWidget {
  /// Creates a [NeCircularButton].
  const NeCircularButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.size = UxnanSize.floatingScrollShortcut,
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
        color: colors.surfaceContainerHighest,
        shape: CircleBorder(side: BorderSide(color: colors.outlineVariant)),
        elevation: 2,
        shadowColor: colors.shadow,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: size,
            height: size,
            child: Icon(
              icon,
              color: colors.onSurfaceVariant,
              size: iconSize,
            ),
          ),
        ),
      ),
    );
  }
}
