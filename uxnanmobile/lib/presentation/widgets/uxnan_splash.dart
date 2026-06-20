import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:uxnan/presentation/theme/motion.dart';

/// Brand splash overlay shown on top of the first frame for a brief moment
/// after Flutter takes over from the native splash screen. It carries the
/// brand mark through the hand-off so the launch reads as one continuous
/// moment instead of a hard cut between the OS splash and the UI.
///
/// Animation: the mark enters at 70% scale rotated a half-turn (180°) and
/// springs up to 100% / 0° in place (`spatialDefault`, slight overshoot),
/// then the whole overlay fades out (`effectsSlow`) once [onReady] fires —
/// usually the first frame after the first route has rendered.
///
/// Surface: the overlay paints a flat white background in both light and dark
/// mode so it matches the native splash window (also white), and uses the
/// black-stroke mark (`logo_nb.svg`), which is the correct variant for a light
/// surface. No runtime tint.
class UxnanSplash extends StatefulWidget {
  /// Creates the splash overlay.
  ///
  /// - [assetPath] is the bundled SVG (the black-stroke mark, `logo_nb.svg`).
  /// - [onReady] is awaited (or fired once) and the overlay dismisses when it
  ///   completes. If never fired, the splash hides itself after [minDuration]
  ///   so a hot-reload or a stuck frame can never strand the app behind it.
  const UxnanSplash({
    required this.assetPath,
    required this.onReady,
    this.minDuration = const Duration(milliseconds: 1400),
    super.key,
  });

  /// SVG asset path (the black-stroke mark, on our own white surface).
  final String assetPath;

  /// Future / callback to await before dismissing the splash.
  final FutureOr<void> Function() onReady;

  /// Hard minimum so the splash is visible long enough to read as a moment
  /// even on a fast device where the first frame lands in <100 ms.
  final Duration minDuration;

  @override
  State<UxnanSplash> createState() => _UxnanSplashState();
}

class _UxnanSplashState extends State<UxnanSplash>
    with TickerProviderStateMixin {
  // Intro progress 0 → 1 (spring may overshoot slightly past 1). Drives both
  // the scale (0.70 → 1.0) and the rotation (0.5 turn → 0).
  late final AnimationController _intro = AnimationController.unbounded(
    vsync: this,
  );
  // Overlay opacity 1 → 0 for the fade-out hand-off.
  late final AnimationController _overlay = AnimationController.unbounded(
    vsync: this,
    value: 1,
  );
  Timer? _minDurationTimer;

  @override
  void initState() {
    super.initState();
    // Start the intro AND the minimum-hold timer on the FIRST painted frame,
    // not here. The engine spends real (and variable) time initializing
    // between `initState` and the first frame: a ticker started now would have
    // already advanced (catching the animation mid-flight or finished), and a
    // timer started now could fire before the animation is even on screen —
    // dismissing the splash before the user sees the spin. Anchoring both to
    // the first frame guarantees the full 70% → 100% / half-turn plays, then
    // the hold, then the fade.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _intro.animateWithSpring(1, M3ESprings.spatialSlow);
      _minDurationTimer = Timer(widget.minDuration, _dismiss);
    });
  }

  Future<void> _dismiss() async {
    if (!mounted) return;
    await widget.onReady();
    if (!mounted) return;
    await _overlay.animateWithSpring(0, M3ESprings.effectsSlow);
    if (mounted) setState(() {}); // drop from the tree
  }

  @override
  void dispose() {
    _minDurationTimer?.cancel();
    _intro.dispose();
    _overlay.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([_intro, _overlay]),
      builder: (context, child) {
        final opacity = _overlay.value.clamp(0.0, 1.0);
        // Once faded out, drop the widget so it can't intercept gestures.
        if (opacity <= 0.001) return const SizedBox.shrink();

        final t = _intro.value;
        final scale = 0.65 + 0.35 * t; // 65% → 100% (with slight overshoot)
        final turns = 0.5 * (1 - t); // half-turn → 0
        return IgnorePointer(
          child: Opacity(
            opacity: opacity,
            // Flat white surface in both modes to match the native splash.
            child: ColoredBox(
              color: Colors.white,
              child: Center(
                child: Transform.rotate(
                  angle: turns * 2 * math.pi,
                  child: Transform.scale(scale: scale, child: child),
                ),
              ),
            ),
          ),
        );
      },
      child: SizedBox(
        width: 128,
        height: 128,
        child: SvgPicture.asset(widget.assetPath),
      ),
    );
  }
}
