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

    // The whole page body scrolls as a single unit: the decorative top band,
    // the hero, the title/body and any extra child all live inside one
    // SingleChildScrollView. The only fixed chrome (Skip, nav buttons, page
    // dots) lives in the parent OnboardingScreen. A LayoutBuilder + a
    // min-height ConstrainedBox keeps short pages vertically centered while
    // tall content (e.g. the install page) stays fully scrollable.
    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.xl,
            0,
            UxnanSpacing.xl,
            UxnanSpacing.xl,
          ),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (top != null) top!,
                Center(
                  child: Container(
                    width: 88,
                    height: 80,
                    decoration: BoxDecoration(
                      color: colors.primaryContainer,
                      borderRadius: const BorderRadius.all(UxnanRadius.xl),
                    ),
                    child: Icon(
                      icon,
                      size: 38,
                      color: colors.onPrimaryContainer,
                    ),
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
        );
      },
    );
  }
}
