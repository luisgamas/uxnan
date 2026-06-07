import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Shared visual scaffold for an onboarding page: a hero icon, a headline, an
/// optional body and an optional extra [child] (e.g. a feature list or command
/// card). Scrolls on short screens and stays centered on tall ones.
class OnboardingPageLayout extends StatelessWidget {
  /// Creates an [OnboardingPageLayout].
  const OnboardingPageLayout({
    required this.icon,
    required this.title,
    this.body,
    this.child,
    this.top,
    super.key,
  });

  /// The hero icon for the page.
  final IconData icon;

  /// The page headline.
  final String title;

  /// Optional supporting copy under the title.
  final String? body;

  /// Optional content shown below the body.
  final Widget? child;

  /// Optional decorative band shown above the centered content (e.g. floating
  /// agent logos).
  final Widget? top;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      children: [
        if (top != null) top!,
        Expanded(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(UxnanSpacing.xl),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 96,
                      height: 96,
                      decoration: BoxDecoration(
                        color: colors.primaryContainer,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(icon, size: 44, color: colors.primary),
                    ),
                  ),
                  const SizedBox(height: UxnanSpacing.xl),
                  Text(
                    title,
                    style: textTheme.headlineMedium,
                    textAlign: TextAlign.center,
                  ),
                  if (body != null) ...[
                    const SizedBox(height: UxnanSpacing.md),
                    Text(
                      body!,
                      style: textTheme.bodyMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                  if (child != null) ...[
                    const SizedBox(height: UxnanSpacing.xl),
                    child!,
                  ],
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
