import 'package:flutter/widgets.dart';

/// Runs [action] once the route [context] sits in has finished arriving — at
/// once when it already has (or there is no route animation, as in a pane).
///
/// Opening a conversation used to start everything in its first frame: the
/// keyboard rising, several requests to the PC whose answers each rebuilt the
/// screen, all while the route was still sliding in and the timeline was being
/// built — the stutter of opening a chat. What the reader cannot see until the
/// screen is there waits for it.
///
/// Returns a cancel callback for `dispose`, so a screen closed while it was
/// still arriving never runs [action].
VoidCallback afterRouteEntrance(BuildContext context, VoidCallback action) {
  var cancelled = false;
  Animation<double>? entrance;
  void onStatus(AnimationStatus status) {
    if (status != AnimationStatus.completed) return;
    entrance?.removeStatusListener(onStatus);
    entrance = null;
    if (!cancelled) action();
  }

  // Read after the first frame: until then a route's animation is a
  // placeholder that already reports itself complete.
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (cancelled || !context.mounted) return;
    final animation = ModalRoute.of(context)?.animation;
    if (animation == null || animation.status == AnimationStatus.completed) {
      action();
      return;
    }
    entrance = animation..addStatusListener(onStatus);
  });
  return () {
    cancelled = true;
    entrance?.removeStatusListener(onStatus);
    entrance = null;
  };
}
