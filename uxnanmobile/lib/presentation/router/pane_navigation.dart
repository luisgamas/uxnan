import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/presentation/providers/shell_device_provider.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/router/route_facts.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';

/// Opening, and going back from, something in the layout you are actually in.
///
/// On a phone a screen is pushed: you went somewhere, and back returns you. In
/// the wide layout there is no "somewhere" — the drawer never moved, and what
/// changed is the **contents of a pane**. Pushing there quietly builds a stack
/// nobody can see: open a conversation, walk into its git screen, pick another
/// conversation from the drawer, and back now walks you through every screen
/// you ever glanced at, in an order that matches nothing on screen.
///
/// So the same tap means two different things, and this is the one place that
/// decides it — every screen's back arrow, every "open this" from a list, the
/// drawer, a notification and a fork go through here. Two rules hold in both
/// layouts:
///
/// - **A screen's own guard is always asked.** Nothing here pops a route
///   behind its back: a file with unsaved edits gets to ask before the pane
///   is emptied under it, exactly as it does for the back gesture.
/// - **What is already open is not opened again.** A notification for the
///   conversation on screen, or a second tap on the same row, changes nothing.
extension PaneNavigation on BuildContext {
  /// Whether this window carries the permanent drawer.
  bool get hasPermanentPane => UxnanBreakpoint.of(this).usesPermanentPane;

  /// The location on top — a pushed screen's, not the base route's — query
  /// included; null outside a router.
  String? get currentLocation {
    final router = GoRouter.maybeOf(this);
    if (router == null || router.routerDelegate.currentConfiguration.isEmpty) {
      return null;
    }
    return router.state.uri.toString();
  }

  /// Opens [location] as a new screen on a phone, or as the pane's new
  /// contents on a wide window — where it **replaces** what was there rather
  /// than stacking on it.
  Future<void> openInPane(String location) async {
    final alreadyHere = currentLocation == location;
    if (!hasPermanentPane) {
      if (!alreadyHere) unawaited(push<void>(location));
      return;
    }
    if (alreadyHere && !(shellNavigatorKey.currentState?.canPop() ?? false)) {
      return;
    }
    // Empty the pane before refilling it. The workspace screens open their
    // own detail screens (a file, the commit history) with a raw
    // `Navigator.push`, which lands ABOVE the routed page — so `go` on its own
    // would swap the page underneath and leave the pushed screen covering it.
    if (!await clearPane()) return;
    if (mounted) go(location);
  }

  /// Pops every screen stacked in the content pane, asking each one first.
  ///
  /// Returns false — and leaves the pane as it is — when a screen declines
  /// (unsaved edits); that screen has then asked the user, who can try again
  /// once they have decided.
  Future<bool> clearPane() async {
    final navigator = shellNavigatorKey.currentState;
    while (navigator != null && navigator.canPop()) {
      Route<dynamic>? top;
      navigator.popUntil((route) {
        top = route;
        return true;
      });
      final route = top;
      if (route != null &&
          route.popDisposition == RoutePopDisposition.doNotPop) {
        route.onPopInvokedWithResult(false, null);
        return false;
      }
      navigator.pop();
    }
    return true;
  }

  /// What "back" means, for every back arrow in the app.
  ///
  /// Whatever was stacked on top of something pops — asking it first — in
  /// every layout: a folder's source control opened from a conversation
  /// returns to that conversation. What remains is the pane's own first
  /// screen, and there the layouts differ. In the wide layout nothing was left
  /// behind — the route was replaced, not stacked — so back **closes what is
  /// open**: the pane empties and the drawer, which never moved, remains. On a
  /// phone with nothing to pop (rotate a tablet and a replaced pane becomes a
  /// stack of one) back goes one level up the hierarchy the phone would have
  /// built — never nowhere.
  Future<void> closePane() async {
    final navigator = Navigator.of(this);
    if (navigator.canPop()) {
      await navigator.maybePop();
      return;
    }
    if (hasPermanentPane) {
      go(AppRoutes.home);
      return;
    }
    final location = currentLocation;
    if (location == null) return;
    go(parentLocationOf(location, ProviderScope.containerOf(this)));
  }
}

/// One level up from [location] — see [RouteFacts.parent].
String parentLocationOf(String location, ProviderContainer container) {
  return RouteFacts.parse(location).parent(
    deviceOfThread: (threadId) =>
        container.read(threadDeviceProvider(threadId)),
    fallbackDevice: container.read(shellDeviceProvider(location)),
  );
}
