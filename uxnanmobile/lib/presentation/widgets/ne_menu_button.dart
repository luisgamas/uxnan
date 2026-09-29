import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

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
    this.icon = UxIcons.moreVert,
    this.onSelected,
    this.enabled = true,
    super.key,
  });

  /// Builds the entries (same contract as [PopupMenuButton.itemBuilder]).
  final PopupMenuItemBuilder<T> itemBuilder;

  /// Tooltip + accessibility label — required, because the trigger is a glyph.
  final String tooltip;

  /// The trigger glyph.
  final UxIconData icon;

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
      icon:
          UxIcon(icon, color: colors.onSurfaceVariant, semanticLabel: tooltip),
      enabled: enabled,
      constraints: kNeMenuConstraints,
      position: PopupMenuPosition.under,
      itemBuilder: itemBuilder,
      onSelected: onSelected,
    );
  }
}

/// Width a submenu takes when there is room for it beside its parent row.
const double kNeSubmenuWidth = 208;

/// The narrowest a submenu may get to stay BESIDE its parent row on a small
/// screen; below that it drops under the row instead.
const double _kNeSubmenuMinWidth = 168;

/// Opens a submenu of [items] for the parent row at [rowContext], the way
/// Material places one (menus guidelines → *Submenus*): **next to the parent
/// item, without overlapping it** — to its right when there is room, to its
/// left when there is not, and, on a screen too narrow for either, just
/// under the row. Its first item lines up with the row that opened it.
///
/// The submenu is a menu of its own over the parent one, which stays open
/// under it: dismissing the submenu returns to the parent, which is "back".
/// Every nested menu in the app opens through here, so they all sit, size and
/// close the same way. An earlier version stepped the submenu down and in
/// from the parent's corner, which laid it OVER the parent menu.
Future<T?> showSubmenu<T>(
  BuildContext rowContext, {
  required List<PopupMenuEntry<T>> items,
}) {
  final row = rowContext.findRenderObject()! as RenderBox;
  final overlay = Navigator.of(rowContext).overlay!.context.findRenderObject()!
      as RenderBox;
  final rowRect = MatrixUtils.transformRect(
    row.getTransformTo(overlay),
    Offset.zero & row.size,
  );
  final screen = overlay.size;
  const margin = 8.0;
  // A menu's list is inset by this much from its top edge; starting the
  // submenu that much higher puts its first item level with the parent row.
  const listInset = 8.0;

  final spaceRight = screen.width - rowRect.right - margin;
  final spaceLeft = rowRect.left - margin;
  double x;
  var y = rowRect.top - listInset;
  var width = kNeSubmenuWidth;
  if (spaceRight >= kNeSubmenuWidth) {
    x = rowRect.right;
  } else if (spaceLeft >= kNeSubmenuWidth) {
    x = rowRect.left - kNeSubmenuWidth;
  } else if (spaceRight >= _kNeSubmenuMinWidth ||
      spaceLeft >= _kNeSubmenuMinWidth) {
    // A phone: the parent menu hugs one edge. Stay beside it, a little
    // narrower, on whichever side has more room.
    if (spaceRight >= spaceLeft) {
      width = spaceRight;
      x = rowRect.right;
    } else {
      width = spaceLeft;
      x = rowRect.left - width;
    }
  } else {
    // No side fits: under the row, never on top of it.
    x = rowRect.left.clamp(margin, screen.width - kNeSubmenuWidth - margin);
    y = rowRect.bottom;
  }

  // The anchor is exactly as wide as the submenu, so the menu lands at [x]
  // whichever edge the route decides to align it to.
  return showMenu<T>(
    context: rowContext,
    position: RelativeRect.fromLTRB(
      x,
      y,
      screen.width - x - width,
      screen.height - y,
    ),
    constraints: BoxConstraints.tightFor(width: width),
    items: items,
  );
}

/// A row in a floating menu that opens a submenu ([showSubmenu]) — the
/// parent item of a nested menu.
///
/// It does not behave like a plain item: a selection closes the menu, and
/// this row's whole job is to open a second one while the first stays up. It
/// borrows a menu item's metrics so it reads as one, carries a trailing
/// chevron, and shows Material's **active** state — the parent item marked
/// while its submenu is open — so which row the submenu came out of is never
/// in question.
///
/// Wrap it in `PopupMenuItem(enabled: false, padding: EdgeInsets.zero)`: the
/// disabled item is what keeps the parent menu from closing under it.
class NeSubmenuRow<T> extends StatefulWidget {
  /// Creates a [NeSubmenuRow].
  const NeSubmenuRow({
    required this.label,
    required this.items,
    required this.onSelected,
    this.subtitle,
    this.icon,
    super.key,
  });

  /// What the row is.
  final String label;

  /// A second line — the current choice, for a row that sets one.
  final String? subtitle;

  /// A leading glyph, when the rows around it have one.
  final UxIconData? icon;

  /// Builds the submenu's entries each time it opens, so a check mark
  /// follows the latest choice.
  final List<PopupMenuEntry<T>> Function() items;

  /// Called with what was picked in the submenu.
  final ValueChanged<T> onSelected;

  @override
  State<NeSubmenuRow<T>> createState() => _NeSubmenuRowState<T>();
}

class _NeSubmenuRowState<T> extends State<NeSubmenuRow<T>> {
  bool _active = false;

  Future<void> _open() async {
    setState(() => _active = true);
    final picked = await showSubmenu<T>(context, items: widget.items());
    if (mounted) setState(() => _active = false);
    if (picked != null) widget.onSelected(picked);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final foreground = _active ? colors.onSecondaryContainer : colors.onSurface;
    final icon = widget.icon;
    final subtitle = widget.subtitle;
    return Material(
      color: _active ? colors.secondaryContainer : Colors.transparent,
      child: InkWell(
        onTap: _active ? null : _open,
        child: ConstrainedBox(
          constraints:
              const BoxConstraints(minHeight: kMinInteractiveDimension),
          child: Padding(
            // The horizontal inset a Material 3 `PopupMenuItem` has, so the
            // icon and label line up with the plain items around this row.
            padding: const EdgeInsets.symmetric(
              horizontal: UxnanSpacing.md,
              vertical: UxnanSpacing.sm,
            ),
            child: Row(
              children: [
                if (icon != null) ...[
                  UxIcon(icon, size: UxnanSize.iconContent, color: foreground),
                  const SizedBox(width: UxnanSpacing.md),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        widget.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: UxnanTypography.menuItem
                            .copyWith(color: foreground),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: textTheme.bodySmall?.copyWith(
                            color: _active
                                ? colors.onSecondaryContainer
                                : colors.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: UxnanSpacing.md),
                UxIcon(
                  UxIcons.chevronRight,
                  size: UxnanSize.iconContentSmall,
                  color: _active
                      ? colors.onSecondaryContainer
                      : colors.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
