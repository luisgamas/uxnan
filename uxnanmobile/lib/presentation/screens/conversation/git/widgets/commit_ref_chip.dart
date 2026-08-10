import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/git/git_log.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A small pill that renders one [GitRef] (branch / remote branch / tag / HEAD)
/// with a type-specific icon and color. Used in the history list rows and the
/// commit detail header so refs read at a glance.
class CommitRefChip extends StatelessWidget {
  /// Creates a [CommitRefChip].
  const CommitRefChip({required this.refData, this.dense = false, super.key});

  /// The ref to render.
  final GitRef refData;

  /// A tighter variant used inside the dense history rows.
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final (icon, bg, fg) = _visuals(colors);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? UxnanSpacing.xs : UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: const BorderRadius.all(UxnanRadius.sm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          UxIcon(icon, size: dense ? 11 : 13, color: fg),
          const SizedBox(width: UxnanSpacing.xs),
          // Flexible + ellipsis so the chip truncates inside a width-capped
          // slot (e.g. the dense graph row) instead of overflowing its row.
          Flexible(
            child: Text(
              refData.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: (dense ? textTheme.labelSmall : textTheme.labelMedium)
                  ?.copyWith(color: fg, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  (UxIconData, Color, Color) _visuals(ColorScheme colors) {
    return switch (refData.type) {
      GitRefType.head => (
          UxIcons.myLocation,
          colors.primaryContainer,
          colors.onPrimaryContainer,
        ),
      GitRefType.branch => (
          UxIcons.callSplit,
          colors.tertiaryContainer,
          colors.onTertiaryContainer,
        ),
      GitRefType.remoteBranch => (
          UxIcons.cloud,
          colors.secondaryContainer,
          colors.onSecondaryContainer,
        ),
      GitRefType.tag => (
          UxIcons.sell,
          colors.surfaceContainerHighest,
          colors.onSurfaceVariant,
        ),
    };
  }
}
