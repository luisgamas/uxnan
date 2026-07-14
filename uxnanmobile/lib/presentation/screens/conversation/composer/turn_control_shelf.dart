import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Compact, collapsible turn context above the composer.
///
/// These controls affect every new turn, so they stay visible enough to audit
/// without occupying the conversation timeline or competing with the prompt.
class TurnControlShelf extends ConsumerWidget {
  /// Creates the shelf.
  const TurnControlShelf({
    required this.threadId,
    required this.options,
    required this.showApproval,
    required this.approvalMode,
    required this.expanded,
    required this.onExpandedChanged,
    required this.onApprovalTap,
    super.key,
  });

  final String threadId;
  final List<AgentModelOption> options;
  final bool showApproval;
  final ApprovalMode approvalMode;
  final bool expanded;
  final ValueChanged<bool> onExpandedChanged;
  final VoidCallback onApprovalTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final selections = ref.watch(threadRunOptionsProvider(threadId));
    final visible = options
        .where((option) => option.kind == 'enum' || option.kind == 'toggle')
        .toList();

    return Row(
      children: [
        _ControlSurface(
          key: const ValueKey('turn-controls-toggle'),
          tooltip:
              expanded ? l10n.composerOptionsHide : l10n.composerOptionsShow,
          icon: Icons.chevron_left_rounded,
          iconTurns: expanded ? 0 : .5,
          onTap: () => onExpandedChanged(!expanded),
        ),
        Expanded(
          child: AnimatedSwitcher(
            layoutBuilder: (currentChild, previousChildren) => Stack(
              alignment: Alignment.centerLeft,
              children: [
                ...previousChildren,
                if (currentChild != null) currentChild,
              ],
            ),
            duration: MediaQuery.disableAnimationsOf(context)
                ? Duration.zero
                : const Duration(milliseconds: 180),
            child: expanded
                ? SingleChildScrollView(
                    key: const ValueKey('turn-controls-expanded'),
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        const SizedBox(width: UxnanSpacing.xs),
                        for (final option in visible) ...[
                          if (option.kind == 'toggle')
                            _ToggleControl(
                              threadId: threadId,
                              option: option,
                              selected: selections[option.key] == true,
                            )
                          else
                            _EnumControl(
                              threadId: threadId,
                              option: option,
                              selected: selections[option.key],
                            ),
                          const SizedBox(width: UxnanSpacing.xs),
                        ],
                        if (showApproval) ...[
                          _ApprovalControl(
                            mode: approvalMode,
                            onTap: onApprovalTap,
                          ),
                          const SizedBox(width: UxnanSpacing.sm),
                        ],
                      ],
                    ),
                  )
                : const SizedBox.shrink(
                    key: ValueKey('turn-controls-collapsed'),
                  ),
          ),
        ),
      ],
    );
  }
}

class _EnumControl extends ConsumerWidget {
  const _EnumControl({
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
    final notifier = ref.read(runOptionSelectionsProvider.notifier);
    var currentLabel = l10n.runOptionAuto;
    for (final value in option.values) {
      if (value.value == selected) currentLabel = value.label;
    }

    return PopupMenuButton<String?>(
      tooltip: '${option.label}: $currentLabel',
      position: PopupMenuPosition.over,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 200),
      onSelected: (value) => value == null
          ? notifier.clear(threadId, option.key)
          : notifier.set(threadId, option.key, value),
      itemBuilder: (context) => [
        PopupMenuItem<String?>(child: Text(l10n.runOptionAuto)),
        for (final value in option.values)
          PopupMenuItem<String?>(value: value.value, child: Text(value.label)),
      ],
      child: _ControlSurface(
        icon: Icons.psychology_alt_outlined,
        tooltip: '${option.label}: $currentLabel',
      ),
    );
  }
}

class _ToggleControl extends ConsumerWidget {
  const _ToggleControl({
    required this.threadId,
    required this.option,
    required this.selected,
  });

  final String threadId;
  final AgentModelOption option;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _ControlSurface(
      icon: selected ? Icons.toggle_on_rounded : Icons.toggle_off_outlined,
      tooltip: option.label,
      selected: selected,
      onTap: () => ref
          .read(runOptionSelectionsProvider.notifier)
          .set(threadId, option.key, !selected),
    );
  }
}

class _ApprovalControl extends StatelessWidget {
  const _ApprovalControl({required this.mode, required this.onTap});

  final ApprovalMode mode;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (label, icon, color) = switch (mode) {
      ApprovalMode.requestApproval => (
          l10n.approvalRequestTitle,
          Icons.pan_tool_outlined,
          UxnanColors.warning,
        ),
      ApprovalMode.approveForMe => (
          l10n.approvalAutoTitle,
          Icons.verified_user_outlined,
          UxnanColors.success,
        ),
      ApprovalMode.fullAccess => (
          l10n.approvalFullTitle,
          Icons.lock_open_rounded,
          UxnanColors.error,
        ),
    };
    return _ControlSurface(
      icon: icon,
      tooltip: label,
      foregroundColor: color,
      onTap: onTap,
    );
  }
}

class _ControlSurface extends StatelessWidget {
  const _ControlSurface({
    required this.icon,
    required this.tooltip,
    this.selected = false,
    this.foregroundColor,
    this.iconTurns = 0,
    this.onTap,
    super.key,
  });

  final IconData icon;
  final String tooltip;
  final bool selected;
  final Color? foregroundColor;
  final double iconTurns;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final foreground = foregroundColor ??
        (selected ? colors.onSecondaryContainer : colors.onSurfaceVariant);
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final body = SizedBox.square(
      dimension: UxnanSize.minTouchTarget,
      child: Center(
        child: Container(
          key: const ValueKey('compact-control-surface'),
          width: UxnanSize.compactComposerChrome,
          height: UxnanSize.compactComposerChrome,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected
                ? colors.secondaryContainer
                : colors.surfaceContainerHigh,
            shape: BoxShape.circle,
          ),
          child: AnimatedRotation(
            turns: iconTurns,
            duration: reduceMotion
                ? Duration.zero
                : const Duration(milliseconds: 180),
            child: Icon(
              icon,
              size: UxnanSize.compactComposerIcon,
              color: foreground,
            ),
          ),
        ),
      ),
    );

    return Tooltip(
      message: tooltip,
      child: Material(
        type: MaterialType.transparency,
        child: onTap == null
            ? body
            : InkResponse(
                onTap: onTap,
                radius: UxnanSpacing.lg,
                child: body,
              ),
      ),
    );
  }
}
