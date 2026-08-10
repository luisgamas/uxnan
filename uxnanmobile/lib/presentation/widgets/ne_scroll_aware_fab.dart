import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/motion.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// A floating action button that gets out of the way while the list behind it
/// is moving, and comes back the moment it settles.
///
/// A FAB sits over the bottom-right of the content, which on a phone is where
/// the last rows of a long list are. While you are scrolling you are reading,
/// not acting — so the button is only ever covering something. It returns on
/// `ScrollEndNotification` rather than on a timer, so the wait is exactly as
/// long as the scroll is, fling included.
///
/// **Motion:** [UxnanMotion.reveal], the same curve and duration the composer's
/// control ribbon uses. A spring is wrong here: the springs in this app model a
/// press — stiff, with a little overshoot — and applied to a button leaving the
/// screen that reads as a snap and a bounce rather than as stepping aside.
///
/// Whoever owns the scroll view drives [visible]; this widget only animates.
class NeScrollAwareFab extends StatelessWidget {
  /// Creates a [NeScrollAwareFab] around [child].
  const NeScrollAwareFab({
    required this.child,
    required this.visible,
    super.key,
  });

  /// The button itself.
  final Widget child;

  /// Whether it should be showing.
  final bool visible;

  /// How far it sinks on its way out. Enough to read as a direction — it steps
  /// down, out of the way — without becoming a slide.
  static const double _sink = UxnanSpacing.md;

  /// It shrinks a little rather than to nothing: a button that scales from zero
  /// pops back like a balloon, which is the harshness this avoids.
  static const double _shrinkTo = 0.85;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(end: visible ? 1 : 0),
      duration: UxnanMotion.revealIn(context),
      curve: UxnanMotion.revealCurve,
      // Out of the tap path once it is gone — an invisible button that still
      // takes taps is worse than no button.
      child: IgnorePointer(ignoring: !visible, child: child),
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, (1 - t) * _sink),
          child: Transform.scale(
            scale: _shrinkTo + (1 - _shrinkTo) * t,
            child: child,
          ),
        ),
      ),
    );
  }
}
