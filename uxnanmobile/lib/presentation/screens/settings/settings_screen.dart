import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/settings/personalization_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/about_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/conversation_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/notifications_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/source_control_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/updates_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/usage_section_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// A single settings section reachable from the landing list.
typedef _Section = ({
  IconData icon,
  String title,
  String subtitle,
  void Function(BuildContext context) open,
});

/// App settings landing: sections grouped into General / Workspace / System.
/// Tapping a section opens a dedicated screen holding that section's options —
/// so the first screen stays scannable instead of listing every toggle at once
/// (guide §4.6: quiet labels over cohesive dynamic-corner card groups).
class SettingsScreen extends ConsumerWidget {
  /// Creates the settings screen.
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    final general = <_Section>[
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
        icon: Icons.data_usage_rounded,
        title: l10n.settingsUsageSection,
        subtitle: l10n.settingsUsageNavSubtitle,
        open: UsageSettingsScreen.push,
      ),
    ];

    final workspace = <_Section>[
      (
        icon: Icons.forum_outlined,
        title: l10n.settingsConversationSection,
        subtitle: l10n.settingsConversationNavSubtitle,
        open: ConversationSectionScreen.push,
      ),
      (
        icon: Icons.commit_rounded,
        title: l10n.settingsGitSection,
        subtitle: l10n.settingsGitNavSubtitle,
        open: SourceControlSectionScreen.push,
      ),
    ];

    final system = <_Section>[
      (
        icon: Icons.system_update_outlined,
        title: l10n.settingsUpdatesSection,
        subtitle: l10n.settingsUpdatesNavSubtitle,
        open: UpdatesSectionScreen.push,
      ),
      (
        icon: Icons.info_outline_rounded,
        title: l10n.settingsAboutTitle,
        subtitle: l10n.settingsAboutSubtitle,
        open: AboutSectionScreen.push,
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
              const _ProfileHeaderCard(),
              NeSectionHeader(label: l10n.settingsGeneralSection, first: true),
              _SectionGroup(sections: general),
              NeSectionHeader(label: l10n.settingsWorkspaceSection),
              _SectionGroup(sections: workspace),
              NeSectionHeader(label: l10n.settingsSystemSection),
              _SectionGroup(sections: system),
            ],
          ),
        ),
      ],
    );
  }
}

/// A tappable profile header at the top of Settings: the user's avatar, name
/// and current active-session count. Opens the full Profile screen on tap.
class _ProfileHeaderCard extends ConsumerWidget {
  const _ProfileHeaderCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final name = ref.watch(profileNameProvider) ?? l10n.profileDisplayName;
    final avatar = ref.watch(profileAvatarProvider);
    final online = ref.watch(connectedDeviceProvider).value != null ? 1 : 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: UxnanSpacing.md),
      child: NeCard(
        onTap: () => context.push(AppRoutes.profile),
        child: Row(
          children: [
            ProfileAvatarView(avatar: avatar, size: 48),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    l10n.profileActiveSessions(online),
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, color: colors.onSurfaceVariant),
          ],
        ),
      ),
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
