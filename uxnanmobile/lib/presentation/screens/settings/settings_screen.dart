import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/context_indicator_mode.dart';
import 'package:uxnan/domain/value_objects/app_update_status.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/update_providers.dart';
import 'package:uxnan/presentation/screens/settings/personalization_screen.dart';
import 'package:uxnan/presentation/screens/settings/prompt_templates_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// App settings. Today it hosts the notification-channel preferences (which
/// turn-end events raise a push / local notification); the toggles persist
/// locally and, while connected, push the change to the bridge via
/// `notifications/update` (spec 02a §5.10).
class SettingsScreen extends ConsumerWidget {
  /// Creates the settings screen.
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final prefs = ref.watch(notificationPreferencesProvider);
    final controller = ref.read(notificationPreferencesProvider.notifier);

    return NeScaffold(
      title: l10n.settingsTitle,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.lg,
            UxnanSpacing.lg,
          ),
          sliver: SliverList.list(
            children: [
              _SectionHeader(label: l10n.settingsAppearanceSection),
              const SizedBox(height: UxnanSpacing.sm),
              _PersonalizationTile(
                onTap: () => PersonalizationScreen.push(context),
              ),
              const SizedBox(height: UxnanSpacing.xl),
              _SectionHeader(label: l10n.settingsNotificationsSection),
              const SizedBox(height: UxnanSpacing.sm),
              _PreferencesCard(
                preferences: prefs,
                onTurnCompletedChanged: (value) =>
                    controller.save(prefs.copyWith(turnCompleted: value)),
                onTurnErrorChanged: (value) =>
                    controller.save(prefs.copyWith(turnError: value)),
              ),
              const SizedBox(height: UxnanSpacing.sm),
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.xs,
                ),
                child: Text(
                  l10n.settingsNotificationsHint,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ),
              const SizedBox(height: UxnanSpacing.xl),
              _SectionHeader(label: l10n.settingsConversationSection),
              const SizedBox(height: UxnanSpacing.sm),
              _ConversationCard(
                showThinking: ref.watch(showAgentThinkingProvider),
                onShowThinkingChanged: (value) => ref
                    .read(showAgentThinkingProvider.notifier)
                    .set(value: value),
                scrollOnSend: ref.watch(scrollToBottomOnSendProvider),
                onScrollOnSendChanged: (value) => ref
                    .read(scrollToBottomOnSendProvider.notifier)
                    .set(value: value),
                contextMode: ref.watch(contextIndicatorModeProvider),
                onContextModeChanged: (value) =>
                    ref.read(contextIndicatorModeProvider.notifier).set(value),
              ),
              const SizedBox(height: UxnanSpacing.sm),
              _PromptTemplatesTile(
                onTap: () => PromptTemplatesScreen.push(context),
              ),
              const SizedBox(height: UxnanSpacing.xl),
              _SectionHeader(label: l10n.settingsModelsSection),
              const SizedBox(height: UxnanSpacing.sm),
              _ModelsCard(
                showClaudeLatest: ref.watch(showClaudeLatestModelsProvider),
                onShowClaudeLatestChanged: (value) => ref
                    .read(showClaudeLatestModelsProvider.notifier)
                    .set(value: value),
              ),
              const SizedBox(height: UxnanSpacing.sm),
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.xs,
                ),
                child: Text(
                  l10n.settingsClaudeLatestHint,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ),
              const SizedBox(height: UxnanSpacing.xl),
              _SectionHeader(label: l10n.settingsGitSection),
              const SizedBox(height: UxnanSpacing.sm),
              _GitCard(
                confirmPush: ref.watch(confirmBeforePushProvider),
                onConfirmPushChanged: (value) => ref
                    .read(confirmBeforePushProvider.notifier)
                    .set(value: value),
                confirmPr: ref.watch(confirmBeforePrProvider),
                onConfirmPrChanged: (value) => ref
                    .read(confirmBeforePrProvider.notifier)
                    .set(value: value),
              ),
              const SizedBox(height: UxnanSpacing.xl),
              _SectionHeader(label: l10n.settingsUpdatesSection),
              const SizedBox(height: UxnanSpacing.sm),
              const _UpdatesCard(),
            ],
          ),
        ),
      ],
    );
  }
}

/// Settings card for the app-update checker: shows the current state and lets
/// the user check now or apply an available update. Honours the
/// no-silent-install policy — applying is always an explicit tap.
class _UpdatesCard extends ConsumerWidget {
  const _UpdatesCard();

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

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: const Icon(Icons.system_update_outlined),
        title: Text(l10n.updateCheckTitle),
        subtitle: Text(subtitle),
        trailing: trailing,
      ),
    );
  }
}

class _ConversationCard extends StatelessWidget {
  const _ConversationCard({
    required this.showThinking,
    required this.onShowThinkingChanged,
    required this.scrollOnSend,
    required this.onScrollOnSendChanged,
    required this.contextMode,
    required this.onContextModeChanged,
  });

  final bool showThinking;
  final ValueChanged<bool> onShowThinkingChanged;
  final bool scrollOnSend;
  final ValueChanged<bool> onScrollOnSendChanged;
  final ContextIndicatorMode contextMode;
  final ValueChanged<ContextIndicatorMode> onContextModeChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.psychology_outlined),
            title: Text(l10n.settingsShowThinkingTitle),
            subtitle: Text(l10n.settingsShowThinkingSubtitle),
            value: showThinking,
            onChanged: onShowThinkingChanged,
          ),
          Divider(height: 1, color: colors.outlineVariant),
          SwitchListTile(
            secondary: const Icon(Icons.vertical_align_bottom_rounded),
            title: Text(l10n.settingsScrollOnSendTitle),
            subtitle: Text(l10n.settingsScrollOnSendSubtitle),
            value: scrollOnSend,
            onChanged: onScrollOnSendChanged,
          ),
          Divider(height: 1, color: colors.outlineVariant),
          ListTile(
            leading: const Icon(Icons.donut_large_outlined),
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
            child: SegmentedButton<ContextIndicatorMode>(
              segments: [
                ButtonSegment(
                  value: ContextIndicatorMode.percentage,
                  label: Text(l10n.settingsContextIndicatorPercentage),
                ),
                ButtonSegment(
                  value: ContextIndicatorMode.tokens,
                  label: Text(l10n.settingsContextIndicatorTokens),
                ),
                ButtonSegment(
                  value: ContextIndicatorMode.both,
                  label: Text(l10n.settingsContextIndicatorBoth),
                ),
              ],
              selected: {contextMode},
              showSelectedIcon: false,
              onSelectionChanged: (selection) =>
                  onContextModeChanged(selection.first),
            ),
          ),
        ],
      ),
    );
  }
}

class _PersonalizationTile extends StatelessWidget {
  const _PersonalizationTile({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: const Icon(Icons.palette_outlined),
        title: Text(l10n.settingsPersonalizationTitle),
        subtitle: Text(l10n.settingsPersonalizationSubtitle),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: onTap,
      ),
    );
  }
}

class _PromptTemplatesTile extends StatelessWidget {
  const _PromptTemplatesTile({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: const Icon(Icons.notes_rounded),
        title: Text(l10n.settingsPromptTemplatesTitle),
        subtitle: Text(l10n.settingsPromptTemplatesSubtitle),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: onTap,
      ),
    );
  }
}

class _ModelsCard extends StatelessWidget {
  const _ModelsCard({
    required this.showClaudeLatest,
    required this.onShowClaudeLatestChanged,
  });

  final bool showClaudeLatest;
  final ValueChanged<bool> onShowClaudeLatestChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: SwitchListTile(
        secondary: const Icon(Icons.auto_awesome_outlined),
        title: Text(l10n.settingsClaudeLatestTitle),
        subtitle: Text(l10n.settingsClaudeLatestSubtitle),
        value: showClaudeLatest,
        onChanged: onShowClaudeLatestChanged,
      ),
    );
  }
}

class _GitCard extends StatelessWidget {
  const _GitCard({
    required this.confirmPush,
    required this.onConfirmPushChanged,
    required this.confirmPr,
    required this.onConfirmPrChanged,
  });

  final bool confirmPush;
  final ValueChanged<bool> onConfirmPushChanged;
  final bool confirmPr;
  final ValueChanged<bool> onConfirmPrChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.arrow_upward_rounded),
            title: Text(l10n.settingsConfirmPushTitle),
            subtitle: Text(l10n.settingsConfirmPushSubtitle),
            value: confirmPush,
            onChanged: onConfirmPushChanged,
          ),
          Divider(height: 1, color: colors.outlineVariant),
          SwitchListTile(
            secondary: const Icon(Icons.merge_rounded),
            title: Text(l10n.settingsConfirmPrTitle),
            subtitle: Text(l10n.settingsConfirmPrSubtitle),
            value: confirmPr,
            onChanged: onConfirmPrChanged,
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.xs),
      child: Text(
        label,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: colors.primary,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

class _PreferencesCard extends StatelessWidget {
  const _PreferencesCard({
    required this.preferences,
    required this.onTurnCompletedChanged,
    required this.onTurnErrorChanged,
  });

  final NotificationPreferences preferences;
  final ValueChanged<bool> onTurnCompletedChanged;
  final ValueChanged<bool> onTurnErrorChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.check_circle_outline_rounded),
            title: Text(l10n.settingsTurnCompletedTitle),
            subtitle: Text(l10n.settingsTurnCompletedSubtitle),
            value: preferences.turnCompleted,
            onChanged: onTurnCompletedChanged,
          ),
          Divider(height: 1, color: colors.outlineVariant),
          SwitchListTile(
            secondary: const Icon(Icons.error_outline_rounded),
            title: Text(l10n.settingsTurnErrorTitle),
            subtitle: Text(l10n.settingsTurnErrorSubtitle),
            value: preferences.turnError,
            onChanged: onTurnErrorChanged,
          ),
        ],
      ),
    );
  }
}
