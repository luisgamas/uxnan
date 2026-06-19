import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:uxnan/presentation/theme/motion.dart';

/// Brand splash overlay shown on top of the first frame for a brief moment
/// after Flutter takes over from the native splash screen. It carries the
/// same logo through the hand-off so the transition reads as one continuous
/// brand moment instead of a hard cut.
///
/// Animation: the logo scales in (`spatialDefault` spring, slight overshoot)
/// while the overall overlay fades out (`effectsSlow`, critically damped) once
/// the [onReady] callback fires — usually the first frame after the first
/// route has been rendered. The native splash is configured with the Android
/// 12+ SplashScreen API (and the iOS launch storyboard) so this Flutter-side
/// layer is just polish; the OS handles the launch animation.
///
/// Dark-mode: the source SVG is a black mark. We paint it white via
/// [ColorFilter.mode] in dark mode so it stays legible on the white splash
/// surface without needing a second, hand-authored white-mark SVG.
class UxnanSplash extends StatefulWidget {
  /// Creates the splash overlay.
  ///
  /// - [assetPath] is the bundled SVG (typically `assets/images/logo_nb.svg`).
  /// - [onReady] is awaited (or fired once) and the overlay dismisses when it
  ///   completes. If never fired, the splash hides itself after [minDuration]
  ///   so a hot-reload or a stuck frame can never strand the app behind it.
  const UxnanSplash({
    required this.assetPath,
    required this.onReady,
    this.minDuration = const Duration(milliseconds: 900),
    super.key,
  });

  /// SVG asset path (the mark, no background — we paint our own).
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
  late final AnimationController _logo = AnimationController.unbounded(
    vsync: this,
    value: 0.85,
  );
  late final AnimationController _overlay = AnimationController.unbounded(
    vsync: this,
    value: 1,
  );
  Timer? _minDurationTimer;

  @override
  void initState() {
    super.initState();
    // Logo scale-in: 0.85 → 1.0 with a slight overshoot (M3E spatialDefault).
    _logo.animateWithSpring(1, M3ESprings.spatialDefault);
    // Stay on-screen for the minimum window, then wait for `onReady` and
    // fade out. If `onReady` finishes earlier we still wait the minimum so
    // the splash reads as a deliberate moment, not a flicker.
    _minDurationTimer = Timer(widget.minDuration, _dismiss);
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
    _logo.dispose();
    _overlay.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // The overlay sits above everything until the fade-out completes; once
    // the opacity hits 0 we drop the widget so it can't intercept gestures.
    final opacity = _overlay.value.clamp(0.0, 1.0);
    if (opacity <= 0.001) return const SizedBox.shrink();

    final colors = Theme.of(context).colorScheme;
    // The splash is a brief, on-brand moment on top of the native splash —
    // we keep its own background white in both modes so the black mark stays
    // legible without a second SVG variant.
    const background = Colors.white;
    final markColor =
        colors.brightness == Brightness.dark ? Colors.white : Colors.black;

    return IgnorePointer(
      child: Opacity(
        opacity: opacity,
        child: ColoredBox(
          color: background,
          child: Center(
            child: ScaleTransition(
              scale: _logo,
              child: SizedBox(
                width: 128,
                height: 128,
                child: ColorFiltered(
                  colorFilter: ColorFilter.mode(markColor, BlendMode.srcIn),
                  child: SvgPicture.asset(widget.assetPath),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
