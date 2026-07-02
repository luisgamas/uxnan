import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The Notifications settings section: choose which agent events notify you.
/// Reached from the settings landing; renders the two notification toggles as a
/// dynamic-corner card group (same tone as the rest of settings). Toggles
/// persist locally and push to the bridge (`notifications/update`).
class NotificationsSectionScreen extends ConsumerWidget {
  /// Creates the notifications section screen.
  const NotificationsSectionScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const NotificationsSectionScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final prefs = ref.watch(notificationPreferencesProvider);
    final notifications = ref.read(notificationPreferencesProvider.notifier);

    return NeScaffold(
      title: l10n.settingsNotificationsSection,
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
            ],
          ),
        ),
      ],
    );
  }
}
