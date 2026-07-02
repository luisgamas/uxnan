import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/licenses_provider.dart';
import 'package:uxnan/presentation/screens/settings/licenses/license_detail_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// Open-source licenses: every third-party package Uxnan bundles, each opening
/// its full license text. Backed by Flutter's `LicenseRegistry` via
/// [packageLicensesProvider].
class LicensesScreen extends ConsumerWidget {
  /// Creates the licenses list screen.
  const LicensesScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const LicensesScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final licenses = ref.watch(packageLicensesProvider);

    return NeScaffold(
      title: l10n.settingsLicensesTitle,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.lg,
            UxnanSpacing.xxl,
          ),
          sliver: licenses.when(
            loading: () => const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.only(top: UxnanSpacing.xxl),
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
            error: (_, __) => SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  NeSectionHint(text: l10n.licensesError),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: () => ref.invalidate(packageLicensesProvider),
                      child: Text(l10n.actionRetry),
                    ),
                  ),
                ],
              ),
            ),
            data: (entries) {
              if (entries.isEmpty) {
                return SliverToBoxAdapter(
                  child: NeSectionHint(text: l10n.licensesEmpty),
                );
              }
              return SliverToBoxAdapter(
                child: ExpressiveCardGroup(
                  count: entries.length,
                  itemBuilder: (context, i, pos) {
                    final entry = entries[i];
                    return NeNavTile(
                      position: pos,
                      icon: Icons.inventory_2_outlined,
                      title: entry.packageName,
                      subtitle: l10n.licenseCountLabel(entry.licenseCount),
                      onTap: () => LicenseDetailScreen.push(context, entry),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
