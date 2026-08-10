import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A floating labelled action that sits above the composer, on the same layer
/// and with the same lift as [NeCircularButton] — the elevated
/// `surfaceContainerHighest` surface, hairline outline and elevation 2 — but
/// stadium-shaped with an icon and a short label.
///
/// Used where a bare glyph would be a guess rather than an affordance: *Queue
/// message* has no conventional icon the way "scroll to latest" has a
/// chevron, so it says what it does.
class NePillButton extends StatelessWidget {
  /// Creates a [NePillButton].
  const NePillButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.emphasized = false,
    this.selected = false,
    super.key,
  });

  /// The leading glyph.
  final UxIconData icon;

  /// The action's label; doubles as its accessibility label.
  final String label;

  /// Tap handler.
  final VoidCallback onTap;

  /// Draws the pill in the primary tone. Reserved for an action the user is
  /// actively reaching for (a drafted message waiting to be queued), as opposed
  /// to an ambient shortcut.
  final bool emphasized;

  /// Draws the pill as currently active — it toggles something that is open.
  /// Uses the secondary container so it is clearly "on" without competing with
  /// an [emphasized] pill beside it.
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final textTheme = theme.textTheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final motion =
        reduceMotion ? Duration.zero : const Duration(milliseconds: 200);

    final background = emphasized
        ? colors.primaryContainer
        : selected
            ? colors.secondaryContainer
            : colors.surfaceContainerHighest;
    final foreground = emphasized
        ? colors.onPrimaryContainer
        : selected
            ? colors.onSecondaryContainer
            : colors.onSurfaceVariant;
    final outline =
        emphasized || selected ? Colors.transparent : colors.outlineVariant;

    return AnimatedContainer(
      duration: motion,
      curve: Curves.easeOutCubic,
      decoration: ShapeDecoration(
        color: background,
        shape: StadiumBorder(side: BorderSide(color: outline)),
        shadows: kElevationToShadow[2],
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: UxnanSize.floatingScrollShortcut,
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: UxnanSpacing.md,
                vertical: UxnanSpacing.xs,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  UxIcon(icon, size: 20, color: foreground),
                  const SizedBox(width: UxnanSpacing.sm),
                  // Animates the tone change instead of snapping between the
                  // idle, selected and emphasized variants.
                  AnimatedDefaultTextStyle(
                    duration: motion,
                    curve: Curves.easeOutCubic,
                    style: textTheme.labelLarge!.copyWith(color: foreground),
                    child: Text(label),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
