import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/motion.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Hides auxiliary composer chrome by sliding it toward the composer while its
/// occupied height collapses.
///
/// The clipping is intentional: the conversation's bottom veil is translucent
/// above the composer, so a translated child must stop painting once it leaves
/// its shrinking layout region instead of remaining visible behind the pill.
class ComposerChromeVisibility extends StatelessWidget {
  /// Creates a visibility transition for auxiliary composer [child] chrome.
  const ComposerChromeVisibility({
    required this.visible,
    required this.child,
    super.key,
  });

  /// Whether [child] is fully visible and interactive.
  final bool visible;

  /// The composer-adjacent banner or control strip to reveal or hide.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(end: visible ? 1 : 0),
      // These values are the app's reveal motion, not this widget's own: they
      // started here and everything that reveals or hides beside content now
      // shares them (see [UxnanMotion]).
      duration: UxnanMotion.revealIn(context),
      curve: UxnanMotion.revealCurve,
      child: ExcludeSemantics(
        excluding: !visible,
        child: IgnorePointer(ignoring: !visible, child: child),
      ),
      builder: (context, progress, child) => ClipRect(
        child: Align(
          alignment: Alignment.bottomCenter,
          heightFactor: progress,
          child: Opacity(
            opacity: progress,
            child: Transform.translate(
              offset: Offset(0, (1 - progress) * UxnanSpacing.xl),
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}
