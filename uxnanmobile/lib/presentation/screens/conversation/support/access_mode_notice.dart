import 'package:flutter/material.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/support/approval_mode_sheet.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Says that the access mode a conversation kept is no longer offered by its
/// agent, and which one it runs in instead; tapping it opens the modes the
/// agent does offer.
class AccessModeNotice extends StatelessWidget {
  /// Creates an [AccessModeNotice].
  const AccessModeNotice({
    required this.retired,
    required this.current,
    required this.agentName,
    required this.onChoose,
    super.key,
  });

  /// The mode the conversation kept.
  final ApprovalMode retired;

  /// The mode it runs in instead.
  final ApprovalMode current;

  /// The agent, as the PC names it.
  final String agentName;

  /// Opens the modes the agent offers.
  final VoidCallback onChoose;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.xs,
        UxnanSpacing.lg,
        0,
      ),
      child: Material(
        color: colors.tertiaryContainer,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onChoose,
          child: Padding(
            padding: const EdgeInsets.all(UxnanSpacing.sm),
            child: Row(
              children: [
                UxIcon(
                  UxIcons.info,
                  size: 20,
                  color: colors.onTertiaryContainer,
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    l10n.approvalModeRetired(
                      agentName,
                      approvalModeTitle(l10n, retired),
                      approvalModeTitle(l10n, current),
                    ),
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onTertiaryContainer,
                    ),
                  ),
                ),
                const SizedBox(width: UxnanSpacing.xs),
                UxIcon(
                  UxIcons.chevronRight,
                  size: 18,
                  color: colors.onTertiaryContainer,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
