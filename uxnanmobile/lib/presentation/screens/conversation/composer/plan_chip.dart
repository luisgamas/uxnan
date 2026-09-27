import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/provider_usage.dart';
import 'package:uxnan/domain/value_objects/window_pace.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/profile/usage_format.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Where the agent's plan stands, as a chip beside the context meter: the
/// used share of its most pressing window, amber when the pace so far hits
/// the limit before the window resets. Tapping it says which window, when it
/// resets, and when the pace runs out.
class PlanChip extends StatelessWidget {
  /// Creates a [PlanChip].
  const PlanChip({required this.plan, required this.name, super.key});

  /// The plan's most pressing window, with its pace.
  final ({UsageWindow window, WindowPace? pace}) plan;

  /// The plan's name (Claude, Codex, Grok).
  final String name;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final window = plan.window;
    final runsOut = plan.pace?.runsOutIn;
    final hot = runsOut != null;
    final reset = window.resetsAt;
    final lines = [
      l10n.composerPlanLine(name, window.label, window.usedPercent.round()),
      if (reset != null && reset.isAfter(DateTime.now()))
        l10n.usageResetsIn(shortDuration(reset.difference(DateTime.now()))),
      if (runsOut != null) l10n.usagePaceRunsOut(shortDuration(runsOut)),
    ];
    final fg = hot ? colors.onErrorContainer : colors.onSurfaceVariant;
    return Tooltip(
      message: lines.join('\n'),
      triggerMode: TooltipTriggerMode.tap,
      showDuration: const Duration(seconds: 4),
      child: Semantics(
        label: lines.join('. '),
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: UxnanSize.compactComposerChrome,
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.sm),
            decoration: BoxDecoration(
              color: hot ? colors.errorContainer : colors.surfaceContainerHigh,
              borderRadius: const BorderRadius.all(UxnanRadius.full),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                UxIcon(UxIcons.planLimit, size: 13, color: fg),
                const SizedBox(width: UxnanSpacing.xs),
                Text(
                  '${window.usedPercent.round()}%',
                  style: UxnanTypography.codeSmall.copyWith(color: fg),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A plan's name, as the chip says it.
String planDisplayName(UsageProvider provider) => switch (provider) {
      UsageProvider.claude => 'Claude',
      UsageProvider.codex => 'Codex',
      UsageProvider.grok => 'Grok',
      UsageProvider.copilot => 'GitHub Copilot',
    };
