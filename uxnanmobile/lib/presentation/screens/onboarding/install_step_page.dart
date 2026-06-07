import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/onboarding/command_card_widget.dart';
import 'package:uxnan/presentation/screens/onboarding/floating_agents.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_page_layout.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logos.dart';

/// Third onboarding page: how to install the bridge on the PC.
class InstallStepPage extends StatelessWidget {
  /// Creates an [InstallStepPage].
  const InstallStepPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colorScheme = Theme.of(context).colorScheme;

    return OnboardingPageLayout(
      icon: Icons.terminal_rounded,
      title: l10n.onboardingInstallTitle,
      body: l10n.onboardingInstallBody,
      top: const FloatingAgents(
        assets: [AgentLogos.antigravity, AgentLogos.gemma, AgentLogos.grok],
        placements: FloatingAgents.layoutC,
      ),
      child: Column(
        children: [
          const CommandCardWidget(command: 'npx uxnan-bridge'),
          const SizedBox(height: UxnanSpacing.md),
          Row(
            children: [
              const Icon(
                Icons.info_outline_rounded,
                size: 18,
                color: UxnanColors.onSurfaceMuted,
                semanticLabel: 'Info',
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Text(
                  l10n.onboardingInstallHint,
                  style: textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
