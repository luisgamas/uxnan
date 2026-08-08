import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// How loud a [NeBadge] is. The tone carries the meaning: reach for the
/// loudest one the fact actually deserves, and no louder.
enum NeBadgeTone {
  /// A quiet fact that is simply true (a date, a stage). Surface family, so it
  /// never competes with anything live on the screen.
  neutral,

  /// Supporting metadata about a thing — how it connects, when it last did.
  /// The container pair, not the solid fill: a card carrying two of these
  /// should read as one calm block, and two solid fills would not.
  secondary,

  /// Something that is **true right now**. The one solid fill in this set,
  /// deliberately the loudest thing on its surface, so it is reserved for live
  /// state (agents working, machines online) and never spent on a label.
  live,
}

/// A small, non-interactive label pill.
///
/// Chips imply tappability and Flutter's `Badge` is for notification counts;
/// neither fits a read-only status label, which is what most of the facts on
/// the overview are. This is the app's one such pill, so a "connected" badge on
/// a device card and an "online" badge in a header cannot drift into two
/// different shapes.
///
/// Type comes from `bodySmall` — one of the five styles the app's `TextTheme`
/// actually defines; anything else falls through to Flutter's default font
/// (see `docs/conventions.md`).
class NeBadge extends StatelessWidget {
  /// Creates a [NeBadge].
  const NeBadge({
    required this.label,
    this.icon,
    this.tone = NeBadgeTone.neutral,
    super.key,
  });

  /// The text shown in the pill.
  final String label;

  /// Optional leading glyph, drawn at 13 dp to sit on the text's own line.
  final IconData? icon;

  /// How loud this badge is; see [NeBadgeTone].
  final NeBadgeTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    final (background, foreground) = switch (tone) {
      NeBadgeTone.neutral => (
          colors.surfaceContainerHigh,
          colors.onSurfaceVariant,
        ),
      NeBadgeTone.secondary => (
          colors.secondaryContainer,
          colors.onSecondaryContainer,
        ),
      NeBadgeTone.live => (colors.tertiary, colors.onTertiary),
    };

    return Container(
      padding: EdgeInsets.fromLTRB(
        icon == null ? UxnanSpacing.sm : UxnanSpacing.xs + 2,
        2,
        UxnanSpacing.sm,
        2,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 13, color: foreground),
            const SizedBox(width: UxnanSpacing.xs),
          ],
          Text(
            label,
            style: textTheme.bodySmall?.copyWith(
              color: foreground,
              fontWeight: FontWeight.w500,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
