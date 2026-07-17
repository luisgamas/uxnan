import 'package:flutter/material.dart';

/// Calm onboarding backdrop aligned with the rest of the app's solid M3
/// surfaces. Expressiveness belongs to the content stage, not to wallpaper
/// competing with every page.
class OnboardingBackground extends StatelessWidget {
  /// Creates an [OnboardingBackground].
  const OnboardingBackground({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return ColoredBox(color: colors.surface);
  }
}
