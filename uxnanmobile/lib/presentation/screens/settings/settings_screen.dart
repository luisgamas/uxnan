import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

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

    return Scaffold(
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(
          parent: AlwaysScrollableScrollPhysics(),
        ),
        slivers: [
          SliverAppBar.large(
            floating: true,
            snap: true,
            title: Text(l10n.settingsTitle),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.lg,
            ),
            sliver: SliverList.list(
              children: [
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
              ],
            ),
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
