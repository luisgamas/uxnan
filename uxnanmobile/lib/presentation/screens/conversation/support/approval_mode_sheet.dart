import 'package:flutter/material.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Bottom sheet to choose how the agent's actions are approved (spec 02a —
/// access modes). Returns the chosen [ApprovalMode] (or null if dismissed).
class ApprovalModeSheet extends StatelessWidget {
  /// Creates an [ApprovalModeSheet].
  const ApprovalModeSheet({required this.current, super.key});

  /// The currently selected mode.
  final ApprovalMode current;

  /// Shows the sheet and resolves with the chosen mode.
  static Future<ApprovalMode?> show(
    BuildContext context,
    ApprovalMode current,
  ) {
    return showModalBottomSheet<ApprovalMode>(
      context: context,
      showDragHandle: true,
      builder: (_) => ApprovalModeSheet(current: current),
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
            _ApprovalOption(
              icon: Icons.pan_tool_outlined,
              title: l10n.approvalRequestTitle,
              body: l10n.approvalRequestBody,
              selected: current == ApprovalMode.requestApproval,
              onTap: () =>
                  Navigator.of(context).pop(ApprovalMode.requestApproval),
            ),
            _ApprovalOption(
              icon: Icons.verified_user_outlined,
              title: l10n.approvalAutoTitle,
              body: l10n.approvalAutoBody,
              selected: current == ApprovalMode.approveForMe,
              onTap: () => Navigator.of(context).pop(ApprovalMode.approveForMe),
            ),
            _ApprovalOption(
              icon: Icons.public_rounded,
              title: l10n.approvalFullTitle,
              body: l10n.approvalFullBody,
              selected: current == ApprovalMode.fullAccess,
              onTap: () => Navigator.of(context).pop(ApprovalMode.fullAccess),
            ),
          ],
        ),
      ),
    );
  }
}

class _ApprovalOption extends StatelessWidget {
  const _ApprovalOption({
    required this.icon,
    required this.title,
    required this.body,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
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
                Icon(icon, size: 22, color: colors.onSurfaceVariant),
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
                  Icon(Icons.check_rounded, color: colors.primary),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
