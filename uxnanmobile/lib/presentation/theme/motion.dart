import 'dart:math' as math;

import 'package:flutter/physics.dart';
import 'package:flutter/widgets.dart';

/// Material 3 Expressive spring-motion tokens, ported from the Neural
/// Expressive design guide (`docs/neural-expressive-design.md` §6.1).
///
/// Flutter's [SpringDescription] takes the **critical** damping coefficient,
/// not M3's damping *ratio*, so the spec ratios are converted here (mass = 1):
/// `damping = ratio * 2 * sqrt(stiffness)`.
///
/// Use spatial tokens for position/size/rotation and effects tokens for
/// color/opacity/fades. `bouncySpatial` is only for elements ≤ 56 dp (chips,
/// FAB menu) — never drawers or large surfaces.
class M3ESprings {
  const M3ESprings._();

  static double _critical(double stiffness, double ratio) =>
      ratio * 2.0 * math.sqrt(stiffness);

  // ── Effects (non-spatial, critically damped — no overshoot) ──────────────
  /// ~150 ms, no bounce. Switches, checkboxes, micro feedback.
  static SpringDescription get effectsFast =>
      SpringDescription(mass: 1, stiffness: 3800, damping: _critical(3800, 1));

  /// ~300 ms, no bounce. Color transitions, menu fades.
  static SpringDescription get effectsDefault =>
      SpringDescription(mass: 1, stiffness: 1600, damping: _critical(1600, 1));

  /// ~500 ms, no bounce. Illustration/background appearance.
  static SpringDescription get effectsSlow =>
      SpringDescription(mass: 1, stiffness: 800, damping: _critical(800, 1));

  // ── Spatial (light overshoot ~10%) ───────────────────────────────────────
  /// Fast with slight overshoot. Icon surfaces, chips, button feedback.
  static SpringDescription get spatialFast =>
      SpringDescription(mass: 1, stiffness: 1400, damping: _critical(1400, .9));

  /// Organic. Bottom sheets, drawer opening, panels.
  static SpringDescription get spatialDefault =>
      SpringDescription(mass: 1, stiffness: 700, damping: _critical(700, .9));

  /// Dramatic, high inertia. Hero animations, full-screen expansions.
  static SpringDescription get spatialSlow =>
      SpringDescription(mass: 1, stiffness: 300, damping: _critical(300, .9));

  /// Big bounce (~40% overshoot). ONLY for elements ≤ 56 dp; never drawers.
  static SpringDescription get bouncySpatial =>
      SpringDescription(mass: 1, stiffness: 400, damping: _critical(400, .4));

  /// Quick return with slight oscillation. Card drag, carousels.
  static SpringDescription get snappySpatial => SpringDescription(
        mass: 1,
        stiffness: 1000,
        damping: _critical(1000, .75),
      );
}

/// Convenience for driving an [AnimationController] with an M3E spring.
extension SpringAnimate on AnimationController {
  /// Animates [value] toward [target] using [spring]. The controller must be
  /// unbounded ([AnimationController.unbounded]) because spatial springs may
  /// overshoot past the 0–1 range.
  TickerFuture animateWithSpring(
    double target,
    SpringDescription spring, {
    double velocity = 0,
  }) {
    return animateWith(SpringSimulation(spring, value, target, velocity));
  }
}
