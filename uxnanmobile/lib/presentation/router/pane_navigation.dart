import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';

/// Opening something in the layout you are actually in.
///
/// On a phone a screen is pushed: you went somewhere, and back returns you. In
/// the wide layout there is no "somewhere" — the drawer never moved, and what
/// changed is the **contents of a pane**. Pushing there quietly builds a stack
/// nobody can see: open a conversation, walk into its git screen, pick another
/// conversation from the drawer, and back now walks you through every screen
/// you ever glanced at, in an order that matches nothing on screen.
///
/// So the same tap means two different things, and this is where that is
/// decided rather than at each of the five call sites that open a conversation.
extension PaneNavigation on BuildContext {
  /// Whether this window carries the permanent drawer.
  bool get hasPermanentPane => UxnanBreakpoint.of(this).usesPermanentPane;

  /// Opens [location] as a new screen on a phone, or as the pane's new
  /// contents on a wide window — where it **replaces** what was there rather
  /// than stacking on it.
  void openInPane(String location) {
    if (!hasPermanentPane) {
      push(location);
      return;
    }
    // Empty the pane before refilling it. The conversation opens its file
    // browser and git screens with a raw `Navigator.push`, which lands ABOVE
    // the routed page — so `go` on its own swaps the page underneath and
    // leaves the pushed screen covering it. From the file browser, picking
    // another conversation looked like nothing happened.
    final navigator = shellNavigatorKey.currentState;
    while (navigator?.canPop() ?? false) {
      navigator!.pop();
    }
    go(location);
  }

  /// What "back" means from the pane's own first screen.
  ///
  /// On a phone it pops, because you really did come from somewhere. In the
  /// wide layout nothing was left behind — the route was replaced, not stacked
  /// — so back is not "the previous screen" but **closing what is open**: the
  /// pane empties and the drawer, which never moved, is what remains.
  void closePane() {
    if (hasPermanentPane) {
      go('/');
    } else {
      Navigator.of(this).maybePop();
    }
  }
}
