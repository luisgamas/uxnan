import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/context_indicator_mode.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';
import 'package:uxnan/presentation/screens/settings/personalization_screen.dart';
import 'package:uxnan/presentation/screens/settings/prompt_templates_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// App settings, laid out as Neural Expressive dynamic-corner card groups
/// (guide §4.6): each section is a quiet label over a cohesive group of rows
/// (3 dp gap, 24/4 radii) on a calm `surfaceContainer` tone — low visual noise,
/// no per-row dividers, no colored section headers. Toggles persist locally;
/// notification toggles also push to the bridge (`notifications/update`).
class SettingsScreen extends ConsumerWidget {
  /// Creates the settings screen.
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final prefs = ref.watch(notificationPreferencesProvider);
    final notifications = ref.read(notificationPreferencesProvider.notifier);

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
              // ── Appearance ─────────────────────────────────────────────
              NeSectionHeader(
                label: l10n.settingsAppearanceSection,
                first: true,
              ),
              NeNavTile(
                icon: Icons.palette_outlined,
                title: l10n.settingsPersonalizationTitle,
                subtitle: l10n.settingsPersonalizationSubtitle,
                onTap: () => PersonalizationScreen.push(context),
              ),

              // ── Notifications ──────────────────────────────────────────
              NeSectionHeader(label: l10n.settingsNotificationsSection),
              ExpressiveCardGroup(
                count: 2,
                itemBuilder: (context, i, pos) => switch (i) {
                  0 => NeSwitchTile(
                      position: pos,
                      icon: Icons.check_circle_outline_rounded,
                      title: l10n.settingsTurnCompletedTitle,
                      subtitle: l10n.settingsTurnCompletedSubtitle,
                      value: prefs.turnCompleted,
                      onChanged: (v) =>
                          notifications.save(prefs.copyWith(turnCompleted: v)),
                    ),
                  _ => NeSwitchTile(
                      position: pos,
                      icon: Icons.error_outline_rounded,
                      title: l10n.settingsTurnErrorTitle,
                      subtitle: l10n.settingsTurnErrorSubtitle,
                      value: prefs.turnError,
                      onChanged: (v) =>
                          notifications.save(prefs.copyWith(turnError: v)),
                    ),
                },
              ),
              NeSectionHint(text: l10n.settingsNotificationsHint),

              // ── Conversation ───────────────────────────────────────────
              NeSectionHeader(label: l10n.settingsConversationSection),
              ExpressiveCardGroup(
                count: 3,
                itemBuilder: (context, i, pos) => switch (i) {
                  0 => NeSwitchTile(
                      position: pos,
                      icon: Icons.psychology_outlined,
                      title: l10n.settingsShowThinkingTitle,
                      subtitle: l10n.settingsShowThinkingSubtitle,
                      value: ref.watch(showAgentThinkingProvider),
                      onChanged: (v) => ref
                          .read(showAgentThinkingProvider.notifier)
                          .set(value: v),
                    ),
                  1 => NeSwitchTile(
                      position: pos,
                      icon: Icons.vertical_align_bottom_rounded,
                      title: l10n.settingsScrollOnSendTitle,
                      subtitle: l10n.settingsScrollOnSendSubtitle,
                      value: ref.watch(scrollToBottomOnSendProvider),
                      onChanged: (v) => ref
                          .read(scrollToBottomOnSendProvider.notifier)
                          .set(value: v),
                    ),
                  _ => _ContextIndicatorTile(
                      position: pos,
                      mode: ref.watch(contextIndicatorModeProvider),
                      onChanged: (v) => ref
                          .read(contextIndicatorModeProvider.notifier)
                          .set(v),
                    ),
                },
              ),
              const SizedBox(height: UxnanSpacing.sm),
              NeNavTile(
                icon: Icons.notes_rounded,
                title: l10n.settingsPromptTemplatesTitle,
                subtitle: l10n.settingsPromptTemplatesSubtitle,
                onTap: () => PromptTemplatesScreen.push(context),
              ),

              // ── Models ─────────────────────────────────────────────────
              NeSectionHeader(label: l10n.settingsModelsSection),
              NeSwitchTile(
                icon: Icons.auto_awesome_outlined,
                title: l10n.settingsClaudeLatestTitle,
                subtitle: l10n.settingsClaudeLatestSubtitle,
                value: ref.watch(showClaudeLatestModelsProvider),
                onChanged: (v) => ref
                    .read(showClaudeLatestModelsProvider.notifier)
                    .set(value: v),
              ),
              NeSectionHint(text: l10n.settingsClaudeLatestHint),

              // ── Source control ─────────────────────────────────────────
              NeSectionHeader(label: l10n.settingsGitSection),
              ExpressiveCardGroup(
                count: 2,
                itemBuilder: (context, i, pos) => switch (i) {
                  0 => NeSwitchTile(
                      position: pos,
                      icon: Icons.arrow_upward_rounded,
                      title: l10n.settingsConfirmPushTitle,
                      subtitle: l10n.settingsConfirmPushSubtitle,
                      value: ref.watch(confirmBeforePushProvider),
                      onChanged: (v) => ref
                          .read(confirmBeforePushProvider.notifier)
                          .set(value: v),
                    ),
                  _ => NeSwitchTile(
                      position: pos,
                      icon: Icons.merge_rounded,
                      title: l10n.settingsConfirmPrTitle,
                      subtitle: l10n.settingsConfirmPrSubtitle,
                      value: ref.watch(confirmBeforePrProvider),
                      onChanged: (v) => ref
                          .read(confirmBeforePrProvider.notifier)
                          .set(value: v),
                    ),
                },
              ),

              // ── Updates ────────────────────────────────────────────────
              NeSectionHeader(label: l10n.settingsUpdatesSection),
              const _UpdatesTile(),
            ],
          ),
        ),
      ],
    );
  }
}

/// The context-indicator mode selector: a label row over a
/// [ConnectedButtonGroup] (the M3E replacement for segmented buttons).
class _ContextIndicatorTile extends StatelessWidget {
  const _ContextIndicatorTile({
    required this.position,
    required this.mode,
    required this.onChanged,
  });

  final CardGroupPosition position;
  final ContextIndicatorMode mode;
  final ValueChanged<ContextIndicatorMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    String labelFor(ContextIndicatorMode m) => switch (m) {
          ContextIndicatorMode.percentage =>
            l10n.settingsContextIndicatorPercentage,
          ContextIndicatorMode.tokens => l10n.settingsContextIndicatorTokens,
          ContextIndicatorMode.both => l10n.settingsContextIndicatorBoth,
        };

    return ExpressiveCard(
      position: position,
      color: colors.surfaceContainer,
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ListTile(
            leading: Icon(
              Icons.donut_large_outlined,
              color: colors.onSurfaceVariant,
            ),
            title: Text(l10n.settingsContextIndicatorTitle),
            subtitle: Text(l10n.settingsContextIndicatorSubtitle),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              0,
              UxnanSpacing.lg,
              UxnanSpacing.md,
            ),
            child: ConnectedButtonGroup<ContextIndicatorMode>(
              values: const [
                ContextIndicatorMode.percentage,
                ContextIndicatorMode.tokens,
                ContextIndicatorMode.both,
              ],
              selected: mode,
              onChanged: onChanged,
              labelBuilder: (value, _) => Text(labelFor(value)),
            ),
          ),
        ],
      ),
    );
  }
}

/// The app-update row: current state + an explicit check/apply action (no
/// silent install). Rendered as a single dynamic-corner card.
class _UpdatesTile extends ConsumerWidget {
  const _UpdatesTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final state = ref.watch(appUpdateControllerProvider);
    final controller = ref.read(appUpdateControllerProvider.notifier);
    final unsupported = state.status?.channel == UpdateChannel.unsupported;

    final String subtitle;
    switch (state.phase) {
      case AppUpdatePhase.checking:
        subtitle = l10n.updateStatusChecking;
      case AppUpdatePhase.upToDate:
        subtitle = unsupported
            ? l10n.updateStatusUnsupported
            : l10n.updateStatusUpToDate;
      case AppUpdatePhase.available:
        final version = state.status?.storeVersion;
        subtitle = version == null
            ? l10n.updateAvailableBody
            : l10n.updateAvailableBodyVersion(version);
      case AppUpdatePhase.error:
        subtitle = l10n.updateStatusError;
      case AppUpdatePhase.idle:
        subtitle = l10n.updateCheckSubtitle;
    }

    final Widget trailing;
    if (state.phase == AppUpdatePhase.checking) {
      trailing = const SizedBox(
        width: 20,
        height: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    } else if (state.hasUpdate) {
      trailing = FilledButton(
        onPressed: state.starting ? null : controller.startUpdate,
        child: Text(
          state.starting ? l10n.updateActionStarting : l10n.updateAction,
        ),
      );
    } else {
      trailing = TextButton(
        onPressed: unsupported ? null : controller.check,
        child: Text(l10n.updateCheckAction),
      );
    }

    return ExpressiveCard(
      color: colors.surfaceContainer,
      padding: EdgeInsets.zero,
      child: ListTile(
        leading: Icon(
          Icons.system_update_outlined,
          color: colors.onSurfaceVariant,
        ),
        title: Text(l10n.updateCheckTitle),
        subtitle: Text(subtitle),
        trailing: trailing,
      ),
    );
  }
}
