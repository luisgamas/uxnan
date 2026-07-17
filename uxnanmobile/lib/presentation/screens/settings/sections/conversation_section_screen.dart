import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/context_indicator_mode.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/settings/prompt_templates_screen.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/settings_tiles.dart';

/// The Conversation settings section, itself grouped into sub-sections:
/// **Agents** (reasoning visibility + context indicator), **Claude** (model
/// picker options), **Pi Agent** (autonomous-mode banner) and **Conversation**
/// (scroll behaviour + prompt templates).
class ConversationSectionScreen extends ConsumerWidget {
  /// Creates the conversation section screen.
  const ConversationSectionScreen({super.key});

  /// Pushes the screen onto the navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const ConversationSectionScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    return NeScaffold(
      title: l10n.settingsConversationSection,
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
              // ── Agents ─────────────────────────────────────────────────
              NeSectionHeader(
                label: l10n.settingsConversationAgentsGroup,
                first: true,
              ),
              ExpressiveCardGroup(
                count: 2,
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
                  _ => _ContextIndicatorTile(
                      position: pos,
                      mode: ref.watch(contextIndicatorModeProvider),
                      onChanged: (v) => ref
                          .read(contextIndicatorModeProvider.notifier)
                          .set(v),
                    ),
                },
              ),

              // ── Claude ─────────────────────────────────────────────────
              NeSectionHeader(label: l10n.settingsConversationClaudeGroup),
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

              // ── Pi Agent ───────────────────────────────────────────────
              NeSectionHeader(label: l10n.settingsConversationPiGroup),
              NeSwitchTile(
                icon: Icons.campaign_outlined,
                title: l10n.settingsAutonomousBannerTitle,
                subtitle: l10n.settingsAutonomousBannerSubtitle,
                value: ref.watch(showAutonomousBannerProvider),
                onChanged: (v) => ref
                    .read(showAutonomousBannerProvider.notifier)
                    .set(value: v),
              ),
              NeSectionHint(text: l10n.settingsAutonomousBannerHint),

              // ── Conversation ───────────────────────────────────────────
              NeSectionHeader(label: l10n.settingsConversationChatGroup),
              ExpressiveCardGroup(
                count: 2,
                itemBuilder: (context, i, pos) => switch (i) {
                  0 => NeSwitchTile(
                      position: pos,
                      icon: Icons.vertical_align_bottom_rounded,
                      title: l10n.settingsScrollOnSendTitle,
                      subtitle: l10n.settingsScrollOnSendSubtitle,
                      value: ref.watch(scrollToBottomOnSendProvider),
                      onChanged: (v) => ref
                          .read(scrollToBottomOnSendProvider.notifier)
                          .set(value: v),
                    ),
                  _ => NeNavTile(
                      position: pos,
                      icon: Icons.notes_rounded,
                      title: l10n.settingsPromptTemplatesTitle,
                      subtitle: l10n.settingsPromptTemplatesSubtitle,
                      onTap: () => PromptTemplatesScreen.push(context),
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
