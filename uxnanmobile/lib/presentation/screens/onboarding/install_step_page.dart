import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/onboarding/command_card_widget.dart';
import 'package:uxnan/presentation/screens/onboarding/floating_agents.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_page_layout.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logos.dart';
import 'package:uxnan/presentation/widgets/ne_surface.dart';

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
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _StepLabel(text: l10n.onboardingInstallStepInstall),
          const SizedBox(height: UxnanSpacing.xs),
          const CommandCardWidget(command: 'npm install -g uxnan-bridge'),
          const SizedBox(height: UxnanSpacing.md),
          _StepLabel(text: l10n.onboardingInstallStepStart),
          const SizedBox(height: UxnanSpacing.xs),
          const CommandCardWidget(command: 'uxnan-bridge start'),
          const SizedBox(height: UxnanSpacing.md),
          // Subtle NE note: the start directory becomes the bridge root, so one
          // bridge serves every folder/repo underneath it.
          NeSurface(
            outlined: true,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.folder_open_rounded,
                  size: 18,
                  color: colorScheme.primary,
                  semanticLabel: 'Root folder',
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    l10n.onboardingInstallRootNote,
                    style: textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          ),
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

/// A small left-aligned label introducing a numbered install step.
class _StepLabel extends StatelessWidget {
  const _StepLabel({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: UxnanSpacing.xs),
      child: Text(
        text,
        textAlign: TextAlign.left,
        style: theme.textTheme.labelMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
