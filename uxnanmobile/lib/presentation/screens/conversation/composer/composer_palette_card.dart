import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The auxiliary surface that floats 8 dp above the composer pill
/// (`docs/neural-expressive-design.md` §4.3).
///
/// One shape for every palette so they read as siblings: an elevated
/// `surfaceContainerHigh` card, a 36 dp `primaryContainer` trigger badge
/// carrying the palette's glyph, the title beside it, a hairline divider and a
/// continuous scrollable list of rows — never a card per entry, because
/// scanning speed matters more here than decorative grouping.
///
/// Extracted so the `@` mentions, the `/` commands and the saved drafts share
/// it literally instead of re-deriving the same geometry three times and
/// drifting apart.
class ComposerPaletteCard extends StatelessWidget {
  /// Creates a [ComposerPaletteCard].
  const ComposerPaletteCard({
    required this.symbol,
    required this.title,
    required this.child,
    this.trailing,
    this.maxHeight = 320,
    this.elevation = 3,
    super.key,
  });

  /// The glyph shown in the trigger badge (`@`, `/`, …).
  final String symbol;

  /// Palette title, beside the badge.
  final String title;

  /// The palette's rows.
  final Widget child;

  /// Optional action at the far end of the header (e.g. "clear all").
  final Widget? trailing;

  /// Cap on the card's height; its rows scroll past it.
  final double maxHeight;

  /// Card elevation — the `/` palette lifts to 3, the `@` list stays flat.
  final double elevation;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
      child: Material(
        color: colors.surfaceContainerHigh,
        elevation: elevation,
        shadowColor: colors.shadow,
        borderRadius: const BorderRadius.all(UxnanRadius.xl),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxHeight),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ComposerPaletteHeader(
                symbol: symbol,
                title: title,
                trailing: trailing,
              ),
              Divider(height: 1, color: colors.outlineVariant),
              Flexible(child: SingleChildScrollView(child: child)),
              const SizedBox(height: UxnanSpacing.xs),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shared visual header for the composer's palettes. The trigger glyph is what
/// makes each surface recognizable without giving any of them a different
/// hierarchy.
class ComposerPaletteHeader extends StatelessWidget {
  /// Creates a [ComposerPaletteHeader].
  const ComposerPaletteHeader({
    required this.symbol,
    required this.title,
    this.trailing,
    super.key,
  });

  /// The glyph shown in the trigger badge.
  final String symbol;

  /// Palette title.
  final String title;

  /// Optional trailing action.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final textTheme = theme.textTheme;
    return Padding(
      // Keyed by its glyph since the palettes were one widget — tests and the
      // element tree both identify a palette by its header.
      key: ValueKey('suggestion-header-$symbol'),
      padding: EdgeInsets.fromLTRB(
        UxnanSpacing.md,
        UxnanSpacing.md,
        // A trailing icon button carries its own padding; without one the card
        // keeps the symmetric gutter.
        trailing == null ? UxnanSpacing.md : UxnanSpacing.xs,
        UxnanSpacing.sm,
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: colors.primaryContainer,
              borderRadius: const BorderRadius.all(UxnanRadius.md),
            ),
            child: Text(
              symbol,
              style: textTheme.titleMedium?.copyWith(
                color: colors.onPrimaryContainer,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Text(
              title,
              style: textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}
