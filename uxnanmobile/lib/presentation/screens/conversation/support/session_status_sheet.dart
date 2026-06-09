import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_actions_sheet.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';
import 'package:uxnan/presentation/screens/conversation/support/approval_mode_sheet.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Floating sheet showing the active session's environment: model, context,
/// approval mode and git (branch, local, commit/push). Modeled on the desktop
/// app's "Environment" menu, driven by the active thread + live git state.
class SessionStatusSheet extends StatefulWidget {
  /// Creates a [SessionStatusSheet].
  const SessionStatusSheet({
    required this.environment,
    this.onApprovalModeChanged,
    this.threadId,
    this.cwd,
    this.onModelTap,
    this.showApprovalMode = true,
    super.key,
  });

  /// The session environment to display.
  final SessionEnvironment environment;

  /// Called when the user picks a new approval mode.
  final ValueChanged<ApprovalMode>? onApprovalModeChanged;

  /// Whether to show the approval-mode row. Hidden for agents that don't
  /// advertise the `approvals` capability (e.g. OpenCode).
  final bool showApprovalMode;

  /// Owning thread, forwarded to the source-control panel.
  final String? threadId;

  /// Workspace directory for git actions; null when the thread has no cwd.
  final String? cwd;

  /// Opens the model picker for the thread's agent, if available.
  final VoidCallback? onModelTap;

  /// Shows the sheet.
  static Future<void> show(
    BuildContext context,
    SessionEnvironment environment, {
    ValueChanged<ApprovalMode>? onApprovalModeChanged,
    String? threadId,
    String? cwd,
    VoidCallback? onModelTap,
    bool showApprovalMode = true,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => SessionStatusSheet(
        environment: environment,
        onApprovalModeChanged: onApprovalModeChanged,
        threadId: threadId,
        cwd: cwd,
        onModelTap: onModelTap,
        showApprovalMode: showApprovalMode,
      ),
    );
  }

  @override
  State<SessionStatusSheet> createState() => _SessionStatusSheetState();
}

class _SessionStatusSheetState extends State<SessionStatusSheet> {
  late SessionEnvironment _env = widget.environment;

  String _approvalLabel(AppLocalizations l10n) => switch (_env.approvalMode) {
        ApprovalMode.requestApproval => l10n.approvalRequestTitle,
        ApprovalMode.approveForMe => l10n.approvalAutoTitle,
        ApprovalMode.fullAccess => l10n.approvalFullTitle,
      };

  Future<void> _editApprovalMode() async {
    final mode = await ApprovalModeSheet.show(context, _env.approvalMode);
    if (mode == null) return;
    setState(() => _env = _env.withApprovalMode(mode));
    widget.onApprovalModeChanged?.call(mode);
  }

  Future<void> _openGit() => GitActionsSheet.show(
        context,
        cwd: widget.cwd,
        threadId: widget.threadId,
      );

  /// Copies the full thread id; the row shows a shortened form. Lets the user
  /// resume the same conversation from the CLI on the PC.
  Future<void> _copyThreadId(AppLocalizations l10n) async {
    final id = widget.threadId;
    if (id == null) return;
    await Clipboard.setData(ClipboardData(text: id));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.threadIdCopied)),
    );
  }

  String _shortId(String id) => id.length <= 12 ? id : '${id.substring(0, 8)}…';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          0,
          UxnanSpacing.lg,
          UxnanSpacing.lg,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SectionHeader(label: l10n.environmentTitle),
              _StatusRow(
                icon: Icons.auto_awesome_outlined,
                label: l10n.environmentModel,
                value: _env.modelName,
                onTap: widget.onModelTap == null
                    ? null
                    : () {
                        Navigator.of(context).pop();
                        widget.onModelTap!.call();
                      },
              ),
              // Concrete version the selected model/alias resolved to on the last
              // turn (e.g. `opus` → `claude-opus-4-8`); shown only when known and
              // it adds information beyond the selected name.
              if (_env.resolvedModel != null &&
                  _env.resolvedModel!.isNotEmpty &&
                  _env.resolvedModel != _env.modelName)
                _StatusRow(
                  icon: Icons.verified_outlined,
                  label: l10n.environmentActiveModel,
                  value: _env.resolvedModel,
                ),
              // FOR-DEV: the bridge does not report token usage yet; show a
              // neutral placeholder instead of a fabricated percentage.
              _StatusRow(
                icon: Icons.donut_large_outlined,
                label: l10n.environmentContext,
                value: _env.hasContext ? '${_env.contextPercent}%' : '—',
              ),
              if (widget.showApprovalMode)
                _StatusRow(
                  icon: Icons.shield_outlined,
                  label: l10n.environmentApprovalMode,
                  value: _approvalLabel(l10n),
                  onTap: _editApprovalMode,
                ),
              if (widget.threadId != null)
                _StatusRow(
                  icon: Icons.tag_outlined,
                  label: l10n.threadIdLabel,
                  value: _shortId(widget.threadId!),
                  onTap: () => _copyThreadId(l10n),
                ),
              const Divider(height: UxnanSpacing.xl),
              _SectionHeader(label: l10n.environmentGit),
              _StatusRow(
                icon: Icons.account_tree_outlined,
                label: l10n.environmentBranch,
                value: _env.gitBranch ?? '—',
                onTap: _openGit,
              ),
              _StatusRow(
                icon: Icons.computer_outlined,
                label: l10n.environmentLocal,
                value: _env.isLocal ? l10n.environmentLocal : '',
              ),
              _StatusRow(
                icon: Icons.cloud_upload_outlined,
                label: l10n.environmentCommitOrPush,
                onTap: _openGit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
      child: Text(
        label.toUpperCase(),
        style: textTheme.bodySmall?.copyWith(
          color: colors.onSurfaceVariant,
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.icon,
    required this.label,
    this.value,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.md),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.xs,
            vertical: UxnanSpacing.md,
          ),
          child: Row(
            children: [
              Icon(icon, size: 20, color: colors.onSurfaceVariant),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(child: Text(label, style: textTheme.bodyMedium)),
              if (value != null && value!.isNotEmpty)
                Text(
                  value!,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              if (onTap != null) ...[
                const SizedBox(width: UxnanSpacing.xs),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 18,
                  color: colors.onSurfaceVariant,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
