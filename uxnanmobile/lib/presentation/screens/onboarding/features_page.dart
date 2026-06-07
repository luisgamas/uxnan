import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/onboarding/floating_agents.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_page_layout.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logos.dart';

/// Second onboarding page: the product's key capabilities.
class FeaturesPage extends StatelessWidget {
  /// Creates a [FeaturesPage].
  const FeaturesPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return OnboardingPageLayout(
      icon: Icons.auto_awesome_rounded,
      title: l10n.onboardingFeaturesTitle,
      top: const FloatingAgents(
        assets: [AgentLogos.kimi, AgentLogos.qwen, AgentLogos.opencode],
        placements: FloatingAgents.layoutB,
      ),
      child: Column(
        children: [
          _FeatureRow(
            icon: Icons.account_tree_rounded,
            color: UxnanColors.codexAgent,
            title: l10n.featureMultiAgentTitle,
            body: l10n.featureMultiAgentBody,
          ),
          const SizedBox(height: UxnanSpacing.lg),
          _FeatureRow(
            icon: Icons.lock_rounded,
            color: UxnanColors.secondary,
            title: l10n.featureE2eeTitle,
            body: l10n.featureE2eeBody,
          ),
          const SizedBox(height: UxnanSpacing.lg),
          _FeatureRow(
            icon: Icons.devices_rounded,
            color: UxnanColors.geminiCliAgent,
            title: l10n.featureLocalFirstTitle,
            body: l10n.featureLocalFirstBody,
          ),
        ],
      ),
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.icon,
    required this.color,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: colors.surfaceContainerHighest,
            borderRadius: const BorderRadius.all(UxnanRadius.md),
          ),
          child: Icon(icon, color: color, size: 22),
        ),
        const SizedBox(width: UxnanSpacing.lg),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: textTheme.titleSmall),
              const SizedBox(height: UxnanSpacing.xs),
              Text(
                body,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
