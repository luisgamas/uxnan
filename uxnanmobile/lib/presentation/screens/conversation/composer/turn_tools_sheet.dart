import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/support/approval_mode_sheet.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The unified "+" **turn-tools** bottom sheet (Neural Expressive §4.3): the
/// single place for the turn's secondary controls that used to crowd the
/// composer — attaching media, the data-driven run-option knobs (reasoning
/// effort, …) and the agent's approval/access mode. Opening it keeps the
/// composer pill minimal (just +, text, mic/send).
class TurnToolsSheet {
  const TurnToolsSheet._();

  /// Shows the sheet. [onApprovalChanged] is called when the user picks a new
  /// approval mode (the screen owns that local-per-thread state).
  static Future<void> show(
    BuildContext context, {
    required String threadId,
    required bool showAttach,
    required List<AgentModelOption> runOptions,
    required bool showApproval,
    required ApprovalMode approvalMode,
    required ValueChanged<ApprovalMode> onApprovalChanged,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _TurnToolsBody(
        threadId: threadId,
        showAttach: showAttach,
        runOptions: runOptions,
        showApproval: showApproval,
        approvalMode: approvalMode,
        onApprovalChanged: onApprovalChanged,
      ),
    );
  }
}

class _TurnToolsBody extends ConsumerStatefulWidget {
  const _TurnToolsBody({
    required this.threadId,
    required this.showAttach,
    required this.runOptions,
    required this.showApproval,
    required this.approvalMode,
    required this.onApprovalChanged,
  });

  final String threadId;
  final bool showAttach;
  final List<AgentModelOption> runOptions;
  final bool showApproval;
  final ApprovalMode approvalMode;
  final ValueChanged<ApprovalMode> onApprovalChanged;

  @override
  ConsumerState<_TurnToolsBody> createState() => _TurnToolsBodyState();
}

class _TurnToolsBodyState extends ConsumerState<_TurnToolsBody> {
  late ApprovalMode _mode = widget.approvalMode;

  Future<void> _editApproval() async {
    final picked = await ApprovalModeSheet.show(context, _mode);
    if (picked == null || !mounted) return;
    setState(() => _mode = picked);
    widget.onApprovalChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final hasRunOptions = widget.runOptions.isNotEmpty;

    return SafeArea(
      top: false,
      child: SingleChildScrollView(
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
                child: Text(l10n.composerTools, style: textTheme.titleSmall),
              ),

              // Attach (FOR-DEV: no file/image picker yet — see composer_bar).
              if (widget.showAttach)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    Icons.attach_file_rounded,
                    color: colors.onSurfaceVariant,
                  ),
                  title: Text(l10n.composerAttach),
                  enabled: false,
                ),

              // Run-option knobs (reasoning effort, …) from the bridge.
              if (hasRunOptions) ...[
                const SizedBox(height: UxnanSpacing.xs),
                _RunOptionsBar(
                  threadId: widget.threadId,
                  options: widget.runOptions,
                ),
              ],

              // Approval/access mode (agents that gate tools).
              if (widget.showApproval) ...[
                const SizedBox(height: UxnanSpacing.sm),
                _ApprovalTile(mode: _mode, onTap: _editApproval),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A data-driven row of run-option "knobs" the bridge advertises for the active
/// model (reasoning effort, etc.). Generic: enum knobs render as a value menu,
/// toggles as a filter chip; unknown kinds are ignored (forward-compatible).
/// Choices persist per thread and ride on `turn/send`.
class _RunOptionsBar extends ConsumerWidget {
  const _RunOptionsBar({required this.threadId, required this.options});

  final String threadId;
  final List<AgentModelOption> options;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selections = ref.watch(threadRunOptionsProvider(threadId));
    final notifier = ref.read(runOptionSelectionsProvider.notifier);
    final visible =
        options.where((o) => o.kind == 'enum' || o.kind == 'toggle').toList();
    if (visible.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: UxnanSpacing.xs,
      runSpacing: UxnanSpacing.xs,
      children: [
        for (final option in visible)
          if (option.kind == 'toggle')
            FilterChip(
              label: Text(option.label),
              selected: selections[option.key] == true,
              visualDensity: VisualDensity.compact,
              onSelected: (value) => notifier.set(threadId, option.key, value),
            )
          else
            _EnumOptionChip(
              threadId: threadId,
              option: option,
              selected: selections[option.key],
            ),
      ],
    );
  }
}

/// An enum run-option knob: a chip showing `label: value` that opens a menu of
/// the advertised values plus an "Auto" entry (clears the choice → default).
class _EnumOptionChip extends ConsumerWidget {
  const _EnumOptionChip({
    required this.threadId,
    required this.option,
    required this.selected,
  });

  final String threadId;
  final AgentModelOption option;
  final Object? selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final notifier = ref.read(runOptionSelectionsProvider.notifier);

    var currentLabel = l10n.runOptionAuto;
    for (final value in option.values) {
      if (value.value == selected) {
        currentLabel = value.label;
        break;
      }
    }

    return PopupMenuButton<String?>(
      tooltip: option.label,
      constraints: const BoxConstraints(minWidth: 200),
      position: PopupMenuPosition.under,
      onSelected: (value) => value == null
          ? notifier.clear(threadId, option.key)
          : notifier.set(threadId, option.key, value),
      itemBuilder: (context) => [
        PopupMenuItem<String?>(child: Text(l10n.runOptionAuto)),
        for (final value in option.values)
          PopupMenuItem<String?>(value: value.value, child: Text(value.label)),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.sm,
          vertical: 6,
        ),
        decoration: BoxDecoration(
          color: colors.surfaceContainerHigh,
          borderRadius: const BorderRadius.all(UxnanRadius.full),
          border: Border.all(color: colors.outlineVariant),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.tune_rounded, size: 14, color: colors.onSurfaceVariant),
            const SizedBox(width: UxnanSpacing.xs),
            Text(
              '${option.label}: $currentLabel',
              style: textTheme.labelMedium,
            ),
            Icon(
              Icons.arrow_drop_down_rounded,
              size: 16,
              color: colors.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}

/// Access/approval-mode row: shows the current mode (alert-toned on full access)
/// and opens the mode picker on tap.
class _ApprovalTile extends StatelessWidget {
  const _ApprovalTile({required this.mode, required this.onTap});

  final ApprovalMode mode;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final isFull = mode == ApprovalMode.fullAccess;
    final (label, icon) = switch (mode) {
      ApprovalMode.requestApproval => (
          l10n.approvalRequestTitle,
          Icons.pan_tool_outlined,
        ),
      ApprovalMode.approveForMe => (
          l10n.approvalAutoTitle,
          Icons.verified_user_outlined,
        ),
      ApprovalMode.fullAccess => (
          l10n.approvalFullTitle,
          Icons.lock_open_rounded,
        ),
    };
    final foreground = isFull ? colors.onErrorContainer : colors.onSurface;

    return Material(
      color: isFull ? colors.errorContainer : colors.surfaceContainerHighest,
      borderRadius: const BorderRadius.all(UxnanRadius.lg),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.md),
          child: Row(
            children: [
              Icon(icon, size: 20, color: foreground),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.environmentApprovalMode,
                      style: textTheme.bodySmall?.copyWith(
                        color: isFull
                            ? colors.onErrorContainer
                            : colors.onSurfaceVariant,
                      ),
                    ),
                    Text(
                      label,
                      style: textTheme.titleSmall?.copyWith(color: foreground),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: foreground),
            ],
          ),
        ),
      ),
    );
  }
}
