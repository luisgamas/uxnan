import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/settings/licenses/licenses_screen.dart';
import 'package:uxnan/presentation/screens/settings/personalization_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/about_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/conversation_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/models_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/notifications_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/source_control_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/updates_section_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// A single settings section reachable from the landing list.
typedef _Section = ({
  IconData icon,
  String title,
  String subtitle,
  void Function(BuildContext context) open,
});

/// App settings landing: a compact list of sections. Tapping a section opens a
/// dedicated screen holding that section's options — so the first screen stays
/// scannable instead of listing every toggle at once (guide §4.6: quiet labels
/// over cohesive dynamic-corner card groups on a calm `surfaceContainer` tone).
class SettingsScreen extends ConsumerWidget {
  /// Creates the settings screen.
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    final sections = <_Section>[
      (
        icon: Icons.palette_outlined,
        title: l10n.settingsPersonalizationTitle,
        subtitle: l10n.settingsPersonalizationSubtitle,
        open: PersonalizationScreen.push,
      ),
      (
        icon: Icons.notifications_outlined,
        title: l10n.settingsNotificationsSection,
        subtitle: l10n.settingsNotificationsNavSubtitle,
        open: NotificationsSectionScreen.push,
      ),
      (
        icon: Icons.forum_outlined,
        title: l10n.settingsConversationSection,
        subtitle: l10n.settingsConversationNavSubtitle,
        open: ConversationSectionScreen.push,
      ),
      (
        icon: Icons.auto_awesome_outlined,
        title: l10n.settingsModelsSection,
        subtitle: l10n.settingsModelsNavSubtitle,
        open: ModelsSectionScreen.push,
      ),
      (
        icon: Icons.commit_rounded,
        title: l10n.settingsGitSection,
        subtitle: l10n.settingsGitNavSubtitle,
        open: SourceControlSectionScreen.push,
      ),
      (
        icon: Icons.system_update_outlined,
        title: l10n.settingsUpdatesSection,
        subtitle: l10n.settingsUpdatesNavSubtitle,
        open: UpdatesSectionScreen.push,
      ),
    ];

    final about = <_Section>[
      (
        icon: Icons.info_outline_rounded,
        title: l10n.settingsAboutTitle,
        subtitle: l10n.settingsAboutSubtitle,
        open: AboutSectionScreen.push,
      ),
      (
        icon: Icons.description_outlined,
        title: l10n.settingsLicensesTitle,
        subtitle: l10n.settingsLicensesSubtitle,
        open: LicensesScreen.push,
      ),
    ];

    return NeScaffold(
      title: l10n.settingsTitle,
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
              _SectionGroup(sections: sections),
              NeSectionHeader(label: l10n.settingsAboutSection),
              _SectionGroup(sections: about),
            ],
          ),
        ),
      ],
    );
  }
}

/// Renders a list of [sections] as one dynamic-corner card group of nav tiles.
class _SectionGroup extends StatelessWidget {
  const _SectionGroup({required this.sections});

  final List<_Section> sections;

  @override
  Widget build(BuildContext context) {
    return ExpressiveCardGroup(
      count: sections.length,
      itemBuilder: (context, i, pos) {
        final section = sections[i];
        return NeNavTile(
          position: pos,
          icon: section.icon,
          title: section.title,
          subtitle: section.subtitle,
          onTap: () => section.open(context),
        );
      },
    );
  }
}
