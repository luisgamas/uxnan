import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/app_info_provider.dart';
import 'package:uxnan/presentation/screens/settings/licenses/licenses_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The public source repository for the project.
const String _kSourceRepoUrl = 'https://sink.gamas.workers.dev/uxnan-repo';

/// The About settings section: app identity + version, a short description, the
/// developer/project info, and links (source code, open-source licenses).
class AboutSectionScreen extends ConsumerWidget {
  /// Creates the about section screen.
  const AboutSectionScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const AboutSectionScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final info = ref.watch(appPackageInfoProvider);

    final versionLabel = info.maybeWhen(
      data: (i) =>
          i.buildNumber.isEmpty ? i.version : '${i.version} (${i.buildNumber})',
      orElse: () => '—',
    );

    return NeScaffold(
      title: l10n.settingsAboutTitle,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.lg,
            UxnanSpacing.xxl,
          ),
          sliver: SliverList.list(
            children: [
              _AboutHeader(versionLabel: versionLabel),
              const SizedBox(height: UxnanSpacing.lg),
              Text(
                l10n.aboutDescription,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
              NeSectionHeader(label: l10n.aboutDeveloperSection),
              NeNavTile(
                icon: Icons.code_rounded,
                title: l10n.aboutSourceCodeTitle,
                subtitle: l10n.aboutSourceCodeSubtitle,
                trailing: Icon(
                  Icons.open_in_new_rounded,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                onTap: () => _open(_kSourceRepoUrl),
              ),
              NeSectionHeader(label: l10n.aboutLegalSection),
              NeNavTile(
                icon: Icons.description_outlined,
                title: l10n.settingsLicensesTitle,
                subtitle: l10n.settingsLicensesSubtitle,
                onTap: () => LicensesScreen.push(context),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Failed to open URL', error, stackTrace);
    }
  }
}

/// The app-identity header: a rounded brand glyph over the app name + version.
class _AboutHeader extends StatelessWidget {
  const _AboutHeader({required this.versionLabel});

  final String versionLabel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Row(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            color: colors.primaryContainer,
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
          ),
          padding: const EdgeInsets.all(UxnanSpacing.md),
          child: SvgPicture.asset(
            'assets/images/logo_fg.svg',
            colorFilter: ColorFilter.mode(
              colors.onPrimaryContainer,
              BlendMode.srcIn,
            ),
          ),
        ),
        const SizedBox(width: UxnanSpacing.lg),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.appTitle, style: textTheme.headlineSmall),
              const SizedBox(height: UxnanSpacing.xs),
              Text(
                l10n.aboutVersionLabel(versionLabel),
                style: textTheme.bodyMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
