import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/profile/profile_screen.dart';
import 'package:uxnan/presentation/screens/settings/personalization_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/about_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/conversation_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/metrics_usage_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/notifications_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/source_control_section_screen.dart';
import 'package:uxnan/presentation/screens/settings/sections/updates_section_screen.dart';
import 'package:uxnan/presentation/screens/shell/app_shell_screen.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ne_entrance_scope.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/profile_avatar_view.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A single settings section reachable from the landing list.
typedef _Section = ({
  UxIconData icon,
  String title,
  String subtitle,
  void Function(BuildContext context) open,
  Widget Function() embedded,
});

/// App settings landing: sections grouped into General / Workspace / System.
/// Tapping a section opens a dedicated screen holding that section's options —
/// so the first screen stays scannable instead of listing every toggle at once
/// (guide §4.6: quiet labels over cohesive dynamic-corner card groups).
class SettingsScreen extends ConsumerStatefulWidget {
  /// Creates the settings screen.
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  /// Which section fills the right pane. Only ever read in the two-pane
  /// layout — narrow, a section is a screen you pushed and there is nothing
  /// on screen to keep selected.
  _Section? _selected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    final general = <_Section>[
      (
        icon: UxIcons.palette,
        title: l10n.settingsPersonalizationTitle,
        subtitle: l10n.settingsPersonalizationSubtitle,
        open: PersonalizationScreen.push,
        embedded: () => const PersonalizationScreen(embedded: true),
      ),
      (
        icon: UxIcons.notifications,
        title: l10n.settingsNotificationsSection,
        subtitle: l10n.settingsNotificationsNavSubtitle,
        open: NotificationsSectionScreen.push,
        embedded: () => const NotificationsSectionScreen(embedded: true),
      ),
      (
        icon: UxIcons.dataUsage,
        title: l10n.settingsUsageSection,
        subtitle: l10n.settingsUsageNavSubtitle,
        open: MetricsUsageSettingsScreen.push,
        embedded: () => const MetricsUsageSettingsScreen(embedded: true),
      ),
    ];

    final workspace = <_Section>[
      (
        icon: UxIcons.forum,
        title: l10n.settingsConversationSection,
        subtitle: l10n.settingsConversationNavSubtitle,
        open: ConversationSectionScreen.push,
        embedded: () => const ConversationSectionScreen(embedded: true),
      ),
      (
        icon: UxIcons.commit,
        title: l10n.settingsGitSection,
        subtitle: l10n.settingsGitNavSubtitle,
        open: SourceControlSectionScreen.push,
        embedded: () => const SourceControlSectionScreen(embedded: true),
      ),
    ];

    final system = <_Section>[
      (
        icon: UxIcons.systemUpdate,
        title: l10n.settingsUpdatesSection,
        subtitle: l10n.settingsUpdatesNavSubtitle,
        open: UpdatesSectionScreen.push,
        embedded: () => const UpdatesSectionScreen(embedded: true),
      ),
      (
        icon: UxIcons.info,
        title: l10n.settingsAboutTitle,
        subtitle: l10n.settingsAboutSubtitle,
        open: AboutSectionScreen.push,
        embedded: () => const AboutSectionScreen(embedded: true),
      ),
    ];

    // The profile is a section like any other here, and the FIRST one: it is
    // the row you are most likely to have come for, and it is what the list is
    // headed by. Personalization was only first because it happened to lead
    // the General group.
    final profile = (
      icon: UxIcons.person,
      title: l10n.profileTitle,
      subtitle: '',
      open: (BuildContext context) => context.push(AppRoutes.profile),
      embedded: () => const ProfileScreen(embedded: true) as Widget,
    );

    final list = NeScaffold(
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
            children: NeEntranceScope.stagger([
              _ProfileHeaderCard(
                selected: (_selected ?? profile).title == profile.title,
                onTap: () => _select(context, profile),
              ),
              NeSectionHeader(label: l10n.settingsGeneralSection, first: true),
              _SectionGroup(
                sections: general,
                selected: _selected,
                onSelect: _select,
              ),
              NeSectionHeader(label: l10n.settingsWorkspaceSection),
              _SectionGroup(
                sections: workspace,
                selected: _selected,
                onSelect: _select,
              ),
              NeSectionHeader(label: l10n.settingsSystemSection),
              _SectionGroup(
                sections: system,
                selected: _selected,
                onSelect: _select,
              ),
            ]),
          ),
        ),
      ],
    );

    // Measured from THIS widget's constraints, not the window: inside the
    // shell's content pane there is a 320 dp drawer already taken out, so a
    // 1280 dp window leaves ~955 dp here — and that, not 1280, decides whether
    // a second column fits.
    return LayoutBuilder(
      builder: (context, constraints) {
        if (!UxnanBreakpoint.fromWidth(constraints.maxWidth)
            .usesPermanentPane) {
          return list;
        }
        final selected = _selected ?? profile;
        return TwoPaneScaffold(
          pane: list,
          // The pane gets its OWN navigator, and that is what keeps a section's
          // children inside it. A section opens its sub-screens with
          // `Navigator.of(context).push` — the theme editor, the licence list —
          // and without a navigator here those resolve to the one above and
          // take over the whole window, list and all. Nested, the same push
          // lands in the pane: left stays the accesses, right becomes the
          // child, and its back arrow returns to the section rather than
          // leaving Settings.
          //
          // Keyed by section so picking a different one starts its own stack
          // instead of inheriting where you had wandered in the last.
          detail: Navigator(
            key: ValueKey('settings-pane-${selected.title}'),
            onGenerateRoute: (_) => MaterialPageRoute<void>(
              builder: (_) => selected.embedded(),
            ),
          ),
        );
      },
    );
  }

  void _select(BuildContext context, _Section section) {
    if (UxnanBreakpoint.of(context).usesPermanentPane) {
      setState(() => _selected = section);
    } else {
      section.open(context);
    }
  }
}

/// A tappable profile header at the top of Settings: the user's avatar, name
/// and current active-session count.
///
/// It sits in the same list as the sections, so it behaves like one: on a wide
/// surface it fills the pane on the right and is marked while it does. It
/// opened a whole new screen at first, which made the one row that looks most
/// like a section the only one that did not act like one.
class _ProfileHeaderCard extends ConsumerWidget {
  const _ProfileHeaderCard({required this.selected, required this.onTap});

  /// Whether the profile is what the pane is showing.
  final bool selected;

  final VoidCallback onTap;

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
        color: selected ? colors.secondaryContainer : null,
        onTap: onTap,
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
            UxIcon(UxIcons.chevronRight, color: colors.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

/// Renders a list of [sections] as one dynamic-corner card group of nav tiles.
class _SectionGroup extends StatelessWidget {
  const _SectionGroup({
    required this.sections,
    required this.selected,
    required this.onSelect,
  });

  final List<_Section> sections;

  /// The section filling the pane, or null on a narrow window where there is
  /// no pane and nothing stays on screen to be selected.
  final _Section? selected;

  final void Function(BuildContext context, _Section section) onSelect;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final wide = UxnanBreakpoint.of(context).usesPermanentPane;
    return ExpressiveCardGroup(
      count: sections.length,
      itemBuilder: (context, i, pos) {
        final section = sections[i];
        // Marked only where the list STAYS on screen beside what it opened.
        // Narrow, a section is a screen you pushed, and marking a row you
        // cannot see behind it would be marking nothing.
        final isSelected = wide && section.title == selected?.title;
        return NeNavTile(
          position: pos,
          icon: section.icon,
          title: section.title,
          subtitle: section.subtitle,
          color: isSelected ? colors.secondaryContainer : null,
          onTap: () => onSelect(context, section),
        );
      },
    );
  }
}
