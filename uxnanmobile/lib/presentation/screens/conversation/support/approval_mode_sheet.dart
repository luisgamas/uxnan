import 'package:flutter/material.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// The name of an access mode, as every surface of the app writes it.
String approvalModeTitle(AppLocalizations l10n, ApprovalMode mode) =>
    switch (mode) {
      ApprovalMode.requestApproval => l10n.approvalRequestTitle,
      ApprovalMode.approveForMe => l10n.approvalAutoTitle,
      ApprovalMode.fullAccess => l10n.approvalFullTitle,
      ApprovalMode.plan => l10n.approvalPlanTitle,
    };

/// Bottom sheet to choose how much the agent may do before it asks (spec 02a —
/// access modes), listing only the modes the agent offers. Returns the chosen
/// [ApprovalMode] (or null if dismissed).
class ApprovalModeSheet extends StatelessWidget {
  /// Creates an [ApprovalModeSheet].
  const ApprovalModeSheet({
    required this.current,
    required this.offered,
    super.key,
  });

  /// The mode the conversation runs in.
  final ApprovalMode current;

  /// The modes its agent offers, in the order to list them.
  final List<ApprovalMode> offered;

  /// Shows the sheet and resolves with the chosen mode.
  static Future<ApprovalMode?> show(
    BuildContext context,
    ApprovalMode current,
    List<ApprovalMode> offered,
  ) {
    return showModalBottomSheet<ApprovalMode>(
      context: context,
      useRootNavigator: true,
      showDragHandle: true,
      builder: (_) => ApprovalModeSheet(current: current, offered: offered),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
              child: Text(l10n.approvalQuestion, style: textTheme.titleSmall),
            ),
            for (final mode in offered)
              _ApprovalOption(
                icon: approvalModeIcon(mode),
                title: approvalModeTitle(l10n, mode),
                body: switch (mode) {
                  ApprovalMode.requestApproval => l10n.approvalRequestBody,
                  ApprovalMode.approveForMe => l10n.approvalAutoBody,
                  ApprovalMode.fullAccess => l10n.approvalFullBody,
                  ApprovalMode.plan => l10n.approvalPlanBody,
                },
                selected: current == mode,
                onTap: () => Navigator.of(context).pop(mode),
              ),
          ],
        ),
      ),
    );
  }
}

/// The glyph of an access mode, the same in the sheet and the composer shelf.
UxIconData approvalModeIcon(ApprovalMode mode) => switch (mode) {
      ApprovalMode.requestApproval => UxIcons.panTool,
      ApprovalMode.approveForMe => UxIcons.verifiedUser,
      ApprovalMode.fullAccess => UxIcons.lockOpen,
      ApprovalMode.plan => UxIcons.checklistRtl,
    };

class _ApprovalOption extends StatelessWidget {
  const _ApprovalOption({
    required this.icon,
    required this.title,
    required this.body,
    required this.selected,
    required this.onTap,
  });

  final UxIconData icon;
  final String title;
  final String body;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
      child: Material(
        color: selected
            ? colors.primaryContainer.withValues(alpha: 0.4)
            : colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        child: InkWell(
          borderRadius: const BorderRadius.all(UxnanRadius.lg),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(UxnanSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                UxIcon(icon, size: 22, color: colors.onSurfaceVariant),
                const SizedBox(width: UxnanSpacing.md),
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
                if (selected) ...[
                  const SizedBox(width: UxnanSpacing.sm),
                  UxIcon(UxIcons.check, color: colors.primary),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
