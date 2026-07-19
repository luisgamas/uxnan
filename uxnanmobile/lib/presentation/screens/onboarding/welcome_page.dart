import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/onboarding/floating_agents.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_page_layout.dart';
import 'package:uxnan/presentation/widgets/agent_logos.dart';

/// First onboarding page: introduces the product.
class WelcomePage extends StatelessWidget {
  /// Creates a [WelcomePage].
  const WelcomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return OnboardingPageLayout(
      icon: Icons.hub_rounded,
      title: l10n.onboardingWelcomeTitle,
      body: l10n.onboardingWelcomeBody,
      top: const FloatingAgents(
        assets: [AgentLogos.claude, AgentLogos.antigravity, AgentLogos.codex],
        placements: FloatingAgents.layoutA,
      ),
    );
  }
}
