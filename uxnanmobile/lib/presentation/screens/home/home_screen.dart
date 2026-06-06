import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The home screen shown after launch.
///
/// Until a bridge is paired it renders an empty state inviting the user to pair
/// a device (spec 02a section 5.4.2 — `home/`). Real session content replaces
/// this once the pairing and session modules land.
class HomeScreen extends ConsumerWidget {
  /// Creates the home screen.
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colorScheme = Theme.of(context).colorScheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.hub_outlined,
              size: 56,
              color: UxnanColors.onSurfaceMuted,
            ),
            const SizedBox(height: UxnanSpacing.lg),
            Text(
              l10n.homeEmptyTitle,
              style: textTheme.headlineMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              l10n.homeEmptyBody,
              style: textTheme.bodyMedium?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UxnanSpacing.xl),
            FilledButton.icon(
              onPressed: () => context.push(AppRoutes.onboarding),
              icon: const Icon(Icons.qr_code_scanner),
              label: Text(l10n.actionPairDevice),
            ),
          ],
        ),
      ),
    );
  }
}
