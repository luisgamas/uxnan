import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/onboarding/features_page.dart';
import 'package:uxnan/presentation/screens/onboarding/floating_agents.dart';
import 'package:uxnan/presentation/screens/onboarding/install_step_page.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_background.dart';
import 'package:uxnan/presentation/screens/onboarding/onboarding_page_layout.dart';
import 'package:uxnan/presentation/screens/onboarding/welcome_page.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logos.dart';

/// Multi-page onboarding flow ending in a CTA to scan the pairing QR.
class OnboardingScreen extends StatefulWidget {
  /// Creates an [OnboardingScreen].
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _controller = PageController();
  int _index = 0;

  static const int _pageCount = 4;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _isLast => _index == _pageCount - 1;

  void _animateTo(int page) => _controller.animateToPage(
        page,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeInOut,
      );

  void _scanQr() => context.push(AppRoutes.pairing);

  void _enterCode() => context.push(AppRoutes.manualPairing);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: OnboardingBackground()),
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: Column(
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: AnimatedOpacity(
                        opacity: _isLast ? 0 : 1,
                        duration: const Duration(milliseconds: 200),
                        child: TextButton(
                          onPressed:
                              _isLast ? null : () => _animateTo(_pageCount - 1),
                          child: Text(l10n.onboardingSkip),
                        ),
                      ),
                    ),
                    Expanded(
                      child: PageView(
                        controller: _controller,
                        onPageChanged: (page) => setState(() => _index = page),
                        children: [
                          const WelcomePage(),
                          const FeaturesPage(),
                          const InstallStepPage(),
                          _PairPage(),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(UxnanSpacing.xl),
                      child: Column(
                        children: [
                          _PageDots(count: _pageCount, index: _index),
                          const SizedBox(height: UxnanSpacing.xl),
                          _BottomControls(
                            isFirst: _index == 0,
                            isLast: _isLast,
                            onBack: () => _animateTo(_index - 1),
                            onNext: () => _animateTo(_index + 1),
                            onScan: _scanQr,
                          ),
                          AnimatedOpacity(
                            opacity: _isLast ? 1 : 0,
                            duration: const Duration(milliseconds: 200),
                            child: TextButton(
                              onPressed: _isLast ? _enterCode : null,
                              child: Text(l10n.actionEnterCode),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PairPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return OnboardingPageLayout(
      icon: Icons.qr_code_scanner_rounded,
      title: l10n.onboardingPairTitle,
      body: l10n.onboardingPairBody,
      top: const FloatingAgents(
        assets: [AgentLogos.claude, AgentLogos.kilocode, AgentLogos.goose],
        placements: FloatingAgents.layoutD,
      ),
    );
  }
}

class _BottomControls extends StatelessWidget {
  const _BottomControls({
    required this.isFirst,
    required this.isLast,
    required this.onBack,
    required this.onNext,
    required this.onScan,
  });

  final bool isFirst;
  final bool isLast;
  final VoidCallback onBack;
  final VoidCallback onNext;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    final primary = isLast
        ? FilledButton.icon(
            onPressed: onScan,
            icon: const Icon(Icons.qr_code_scanner_rounded),
            label: Text(l10n.actionScanQr),
          )
        : FilledButton(onPressed: onNext, child: Text(l10n.onboardingNext));

    if (isFirst) {
      return SizedBox(width: double.infinity, height: 56, child: primary);
    }
    return Row(
      children: [
        Expanded(
          child: SizedBox(
            height: 56,
            child: OutlinedButton(
              onPressed: onBack,
              child: Text(l10n.onboardingBack),
            ),
          ),
        ),
        const SizedBox(width: UxnanSpacing.md),
        Expanded(child: SizedBox(height: 56, child: primary)),
      ],
    );
  }
}

class _PageDots extends StatelessWidget {
  const _PageDots({required this.count, required this.index});

  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List<Widget>.generate(count, (i) {
        final isActive = i == index;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 240),
          margin: const EdgeInsets.symmetric(horizontal: UxnanSpacing.xs),
          width: isActive ? 24 : 8,
          height: 8,
          decoration: BoxDecoration(
            color: isActive ? colors.primary : colors.outline,
            borderRadius: const BorderRadius.all(UxnanRadius.full),
          ),
        );
      }),
    );
  }
}
