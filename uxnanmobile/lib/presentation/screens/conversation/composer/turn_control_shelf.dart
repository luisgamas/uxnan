import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/enums/approval_mode.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/motion.dart';
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

  /// Sentinel value for the "Auto" (cleared) menu entry, so a dismissed menu
  /// (`showMenu` returns null) is distinguishable from picking "Auto".
  static const String _autoValue = '__uxnan_run_option_auto__';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    var currentLabel = l10n.runOptionAuto;
    for (final value in option.values) {
      if (value.value == selected) currentLabel = value.label;
    }

    // Opens the value menu from the shared circular control surface — not a
    // PopupMenuButton, whose internal InkWell renders a square ripple — so the
    // press feedback matches the round buttons beside it.
    return _ControlSurface(
      icon: Icons.psychology_alt_outlined,
      tooltip: '${option.label}: $currentLabel',
      onTap: () => _openMenu(context, l10n, ref),
    );
  }

  Future<void> _openMenu(
    BuildContext context,
    AppLocalizations l10n,
    WidgetRef ref,
  ) async {
    final notifier = ref.read(runOptionSelectionsProvider.notifier);
    final button = context.findRenderObject()! as RenderBox;
    final overlay =
        Overlay.of(context).context.findRenderObject()! as RenderBox;
    // Anchor the menu over the button (mirrors PopupMenuPosition.over).
    final position = RelativeRect.fromRect(
      button.localToGlobal(Offset.zero, ancestor: overlay) & button.size,
      Offset.zero & overlay.size,
    );
    final value = await showMenu<String?>(
      context: context,
      position: position,
      constraints: const BoxConstraints(minWidth: 200),
      items: [
        PopupMenuItem<String?>(
          value: _autoValue,
          child: Text(l10n.runOptionAuto),
        ),
        for (final choice in option.values)
          PopupMenuItem<String?>(
            value: choice.value,
            child: Text(choice.label),
          ),
      ],
    );
    if (value == null) return; // dismissed without choosing
    if (value == _autoValue) {
      notifier.clear(threadId, option.key);
    } else {
      notifier.set(threadId, option.key, value);
    }
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

/// A compact sibling of [IconSurface] for the composer chrome: a 38 dp circular
/// surface (24 dp glyph) inside a 48 dp touch target. It mirrors [IconSurface]
/// so the shelf buttons behave exactly like the app-bar actions: the M3E
/// `spatialFast` press-scale and, crucially, a circular tap ink via a
/// circle-shaped `Material` plus an `InkWell` with a `CircleBorder` custom
/// border (a transparent, unshaped Material renders a grey **square** ripple).
/// Adds an [iconTurns] rotation for the collapse chevron.
class _ControlSurface extends StatefulWidget {
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
  State<_ControlSurface> createState() => _ControlSurfaceState();
}

class _ControlSurfaceState extends State<_ControlSurface>
    with SingleTickerProviderStateMixin {
  late final AnimationController _scale =
      AnimationController.unbounded(vsync: this, value: 1);

  @override
  void dispose() {
    _scale.dispose();
    super.dispose();
  }

  void _press() => _scale.animateWithSpring(0.92, M3ESprings.spatialFast);
  void _release() => _scale.animateWithSpring(1, M3ESprings.spatialFast);

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final enabled = widget.onTap != null;
    final foreground = widget.foregroundColor ??
        (widget.selected
            ? colors.onSecondaryContainer
            : colors.onSurfaceVariant);
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    final surface = Material(
      color: widget.selected
          ? colors.secondaryContainer
          : colors.surfaceContainerHigh,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: widget.onTap,
        child: SizedBox.square(
          key: const ValueKey('compact-control-surface'),
          dimension: UxnanSize.compactComposerChrome,
          child: Center(
            child: AnimatedRotation(
              turns: widget.iconTurns,
              duration: reduceMotion
                  ? Duration.zero
                  : const Duration(milliseconds: 180),
              child: Icon(
                widget.icon,
                size: UxnanSize.compactComposerIcon,
                color: foreground,
              ),
            ),
          ),
        ),
      ),
    );

    return Tooltip(
      message: widget.tooltip,
      child: GestureDetector(
        onTapDown: enabled ? (_) => _press() : null,
        onTapUp: enabled ? (_) => _release() : null,
        onTapCancel: enabled ? _release : null,
        child: ScaleTransition(
          scale: _scale,
          child: SizedBox.square(
            dimension: UxnanSize.minTouchTarget,
            child: Center(child: surface),
          ),
        ),
      ),
    );
  }
}
