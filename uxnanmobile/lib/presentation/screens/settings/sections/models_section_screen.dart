import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The Models settings section: options for the model picker (currently the
/// Claude Code "(latest)" alias visibility).
class ModelsSectionScreen extends ConsumerWidget {
  /// Creates the models section screen.
  const ModelsSectionScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const ModelsSectionScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    return NeScaffold(
      title: l10n.settingsModelsSection,
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
            ],
          ),
        ),
      ],
    );
  }
}
