import 'package:flutter/material.dart';
import 'package:hugeicons/hugeicons.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The app's icon. Draws a [UxIcons] glyph, and is the only place that talks to
/// the Hugeicons package.
///
/// It exists because [HugeIcon] is not a drop-in for Flutter's [Icon]:
///
/// - **It has no `semanticLabel`.** [Icon] announces itself to a screen reader;
///   `HugeIcon` renders silently. Icon-only controls are required to carry a
///   label here (`docs/conventions.md`), so this wraps one on.
/// - **It sizes itself to a hard-coded 24.** [Icon] falls back to the ambient
///   [IconTheme], which is how a `ListTile`, an `IconButton` or a menu row set
///   the size of the glyph inside them. This restores that.
///
/// Colour needs no help: the package already resolves `currentColor` through
/// [IconTheme] → [DefaultTextStyle] → `colorScheme.onSurface`, so a glyph tints
/// itself from whatever surface it lands on, in both themes.
class UxIcon extends StatelessWidget {
  /// Creates a [UxIcon] drawing [icon].
  const UxIcon(
    this.icon, {
    this.size,
    this.color,
    this.semanticLabel,
    this.strokeWidth,
    super.key,
  });

  /// The glyph, from [UxIcons].
  final UxIconData icon;

  /// Height and width in logical pixels; defaults to the ambient [IconTheme],
  /// then to 24.
  final double? size;

  /// Stroke colour; defaults to the ambient icon/text colour.
  final Color? color;

  /// What a screen reader announces. Required in practice for an icon-only
  /// control; leave null for a glyph that merely decorates labelled text, so it
  /// is not read twice.
  final String? semanticLabel;

  /// Overrides the stroke weight; defaults to [UxnanSize.iconStroke].
  ///
  /// Lower it for a glyph that should recede, raise it for one that must hold
  /// its own against heavier neighbours.
  final double? strokeWidth;

  /// Fraction of its box a glyph is drawn at, so a given `size` inks the same
  /// as the Material icon it replaced.
  ///
  /// Measured, not guessed: at 16/20/22/24 dp a Material glyph inks exactly
  /// 0.750 of its box (the 18-in-24 live area) while a Hugeicons SVG inks
  /// ~0.862, because the package paints the artwork edge to edge at the size it
  /// is given. Without this every icon in the app arrives ~15% larger than the
  /// layout around it was tuned for — which is not a per-screen bug to chase
  /// sixty times, it is one number.
  ///
  /// The widget still OCCUPIES the full `size`, so nothing reflows: only the
  /// artwork inside it shrinks.
  static const double _opticalScale = 0.75 / 0.862;

  @override
  Widget build(BuildContext context) {
    final iconTheme = IconTheme.of(context);
    final box = size ?? iconTheme.size ?? 24;
    final glyph = SizedBox.square(
      dimension: box,
      child: Center(
        child: HugeIcon(
          icon: icon,
          size: box * _opticalScale,
          color: color,
          strokeWidth: strokeWidth ?? UxnanSize.iconStroke,
        ),
      ),
    );
    final label = semanticLabel;
    if (label == null) return glyph;
    return Semantics(
      label: label,
      // The glyph draws nothing a reader could announce, but excluding its
      // subtree keeps the SVG's own nodes from ever leaking into the tree.
      child: ExcludeSemantics(child: glyph),
    );
  }
}
