import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// What the content pane shows before anything is open.
///
/// **No app bar.** A bar would carry a title for a surface that is not a
/// screen you navigated to and cannot navigate back from — and a back button
/// beside a permanent drawer points nowhere.
///
/// It is deliberately not the overview: with the drawer already showing your
/// PCs and their work, repeating that on the right says the same thing twice
/// and leaves the eye with no reason to prefer either half. This is the quiet
/// half of the layout — the mark, what the name means, and the one thing a
/// first-time reader actually needs, which is how to attach a machine.
class ShellWelcome extends StatelessWidget {
  /// Creates a [ShellWelcome].
  const ShellWelcome({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return ColoredBox(
      color: colors.surface,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(UxnanSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // The tintable foreground mark, so it follows the theme rather
                // than needing a light and a dark copy.
                SvgPicture.asset(
                  'assets/images/logo_fg.svg',
                  height: 72,
                  colorFilter: ColorFilter.mode(
                    colors.onSurface,
                    BlendMode.srcIn,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.lg),
                Text(
                  l10n.appTitle,
                  style: textTheme.headlineMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: UxnanSpacing.sm),
                Text(
                  l10n.shellWelcomeTagline,
                  style: textTheme.bodySmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: UxnanSpacing.xl),
                Text(
                  l10n.shellWelcomeHint,
                  style: textTheme.bodyMedium?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: UxnanSpacing.sm),
                TextButton(
                  onPressed: () => context.push(AppRoutes.onboarding),
                  child: Text(l10n.shellHowToPair),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
