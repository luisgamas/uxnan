import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The Source control settings section: the Git safety confirmations (confirm
/// before push, confirm before opening a pull request).
class SourceControlSectionScreen extends ConsumerWidget {
  /// Creates the source-control section screen.
  const SourceControlSectionScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const SourceControlSectionScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    return NeScaffold(
      title: l10n.settingsGitSection,
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
            ],
          ),
        ),
      ],
    );
  }
}
