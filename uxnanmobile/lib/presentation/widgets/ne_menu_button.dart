import 'package:flutter/material.dart';

/// Minimum width every floating menu opens at.
///
/// `PopupMenuThemeData` has no size field, so a menu otherwise hugs its longest
/// label — two entries and six then look like different components. Both menu
/// triggers pass this, so they cannot drift apart.
const BoxConstraints kNeMenuConstraints = BoxConstraints(minWidth: 208);

/// The **in-content** menu trigger: a plain ⋮ (or any glyph) that opens the
/// app's floating menu, for a control living inside a card, row or list item.
///
/// Its sibling is `IconSurfaceMenu`, the **chrome** trigger, which wears a
/// filled circular surface because it sits on a transparent app bar with
/// scrolling content behind it. Inside a card there is nothing to lift the
/// glyph off, so a filled circle there reads as a second button stacked on the
/// surface it already sits on.
///
/// Two triggers, one menu: the surface, radius, tone and type all come from
/// `ThemeData.popupMenuTheme`, so wherever a menu is opened from it is the same
/// menu.
class NeMenuButton<T> extends StatelessWidget {
  /// Creates a [NeMenuButton].
  const NeMenuButton({
    required this.itemBuilder,
    required this.tooltip,
    this.icon = Icons.more_vert_rounded,
    this.onSelected,
    this.enabled = true,
    super.key,
  });

  /// Builds the entries (same contract as [PopupMenuButton.itemBuilder]).
  final PopupMenuItemBuilder<T> itemBuilder;

  /// Tooltip + accessibility label — required, because the trigger is a glyph.
  final String tooltip;

  /// The trigger glyph.
  final IconData icon;

  /// Called with the chosen value. Optional: entries may carry their own
  /// `onTap` instead (what the `void`-typed menus do).
  final PopupMenuItemSelected<T>? onSelected;

  /// When false the trigger reads as disabled and won't open.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return PopupMenuButton<T>(
      tooltip: tooltip,
      icon: Icon(icon, color: colors.onSurfaceVariant, semanticLabel: tooltip),
      enabled: enabled,
      constraints: kNeMenuConstraints,
      position: PopupMenuPosition.under,
      itemBuilder: itemBuilder,
      onSelected: onSelected,
    );
  }
}
