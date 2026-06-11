import 'package:flutter/material.dart';
import 'package:uxnan/core/extensions/string_ext.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// The message composer: a Material 3 bottom bar **anchored to the screen
/// edge** (not a floating card) — a `surfaceContainer` surface with a top
/// hairline that reads as chrome, holding an expandable text field and a
/// toolbar (attach, model selector, context usage, voice, send). Attach and
/// voice are placeholders (FOR-DEV).
class ComposerBar extends StatefulWidget {
  /// Creates a [ComposerBar].
  const ComposerBar({
    required this.onSend,
    required this.environment,
    this.resolvedModel,
    this.onModelTap,
    this.enabled = true,
    this.showAttach = true,
    super.key,
  });

  /// Called with the trimmed message when the user sends.
  final ValueChanged<String> onSend;

  /// The session environment (model, context) shown in the toolbar.
  final SessionEnvironment environment;

  /// Concrete model the alias resolved to (e.g. `claude-opus-4-8`), shown as
  /// the model chip's tooltip when known.
  final String? resolvedModel;

  /// Opens the model picker for the active thread, if available.
  final VoidCallback? onModelTap;

  /// Whether sending is currently allowed (e.g. connected).
  final bool enabled;

  /// Whether to show the attach button. Hidden for agents that don't advertise
  /// the `images` capability (the picker itself is still FOR-DEV).
  final bool showAttach;

  @override
  State<ComposerBar> createState() => _ComposerBarState();
}

class _ComposerBarState extends State<ComposerBar> {
  final TextEditingController _controller = TextEditingController();
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_onChanged)
      ..dispose();
    super.dispose();
  }

  void _onChanged() {
    final hasText = _controller.text.isNotBlank;
    if (hasText != _hasText) setState(() => _hasText = hasText);
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty || !widget.enabled) return;
    widget.onSend(text);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final canSend = _hasText && widget.enabled;

    // M3 bottom-anchored input bar: a `surfaceContainer` tone (the BottomAppBar
    // default) with a top hairline, no rounded card / no shadow — it reads as
    // chrome that's part of the screen, letting the conversation breathe.
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainer,
        border: Border(top: BorderSide(color: colors.outlineVariant)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.sm,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _controller,
                enabled: widget.enabled,
                minLines: 1,
                maxLines: 6,
                style: textTheme.bodyMedium,
                decoration: InputDecoration(
                  isCollapsed: true,
                  border: InputBorder.none,
                  hintText: l10n.composerHint,
                  hintStyle: TextStyle(color: colors.onSurfaceVariant),
                ),
              ),
              const SizedBox(height: UxnanSpacing.sm),
              Row(
                children: [
                  // FOR-DEV: attach is a placeholder (no file/image picker
                  // yet); shown only when the agent advertises `images`.
                  if (widget.showAttach) ...[
                    _RoundIconButton(
                      icon: Icons.add_rounded,
                      tooltip: l10n.composerAttach,
                      onPressed: null,
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                  ],
                  Flexible(
                    child: _ModelChip(
                      model: widget.environment.modelName,
                      resolvedModel: widget.resolvedModel,
                      onTap: widget.onModelTap,
                    ),
                  ),
                  const Spacer(),
                  // Context usage (only for agents that report it): a percent
                  // ring once the window is known (Claude), else a raw token
                  // count (Codex). Shown at 0 until the first turn reports it,
                  // so the meter is always present for usage-reporting agents.
                  if (widget.environment.showContext) ...[
                    if (widget.environment.hasContext)
                      _ContextBadge(percent: widget.environment.contextPercent)
                    else
                      _TokenChip(
                        label: widget.environment.contextTokensLabel ?? '0',
                      ),
                    const SizedBox(width: UxnanSpacing.xs),
                  ],
                  // FOR-DEV: voice input is a placeholder (no STT yet).
                  _RoundIconButton(
                    icon: Icons.mic_none_rounded,
                    tooltip: l10n.composerVoice,
                    onPressed: null,
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  IconButton.filled(
                    tooltip: l10n.composerSend,
                    onPressed: canSend ? _send : null,
                    icon: const Icon(Icons.arrow_upward_rounded),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return IconButton(
      tooltip: tooltip,
      visualDensity: VisualDensity.compact,
      icon: Icon(icon, size: 20, color: colors.onSurfaceVariant),
      onPressed: onPressed,
    );
  }
}

/// Model selector: an M3 [ActionChip] (the only model selector — the old status
/// sheet's model row was removed). Its tooltip surfaces the resolved version.
class _ModelChip extends StatelessWidget {
  const _ModelChip({required this.model, this.resolvedModel, this.onTap});
  final String model;
  final String? resolvedModel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Tooltip(
      message: resolvedModel ?? model,
      child: ActionChip(
        avatar: Icon(
          Icons.auto_awesome_outlined,
          size: 16,
          color: colors.onSurfaceVariant,
        ),
        label: Text(model, overflow: TextOverflow.ellipsis),
        visualDensity: VisualDensity.compact,
        onPressed: onTap,
      ),
    );
  }
}

class _ContextBadge extends StatelessWidget {
  const _ContextBadge({required this.percent});
  final int percent;

  @override
  Widget build(BuildContext context) {
    final color = percent >= 90
        ? UxnanColors.error
        : percent >= 70
            ? UxnanColors.warning
            : UxnanColors.success;
    return Tooltip(
      message: 'Context $percent%',
      child: SizedBox(
        width: 30,
        height: 30,
        child: Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(
                value: percent / 100,
                strokeWidth: 2.5,
                backgroundColor: color.withValues(alpha: 0.2),
                valueColor: AlwaysStoppedAnimation<Color>(color),
              ),
            ),
            Text('$percent', style: UxnanTypography.codeSmall),
          ],
        ),
      ),
    );
  }
}

/// Raw token-count chip, shown when the context window is unknown (Codex) so
/// usage is still visible without a percentage.
class _TokenChip extends StatelessWidget {
  const _TokenChip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Tooltip(
      message: 'Context: $label tokens',
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.sm,
          vertical: 4,
        ),
        decoration: BoxDecoration(
          color: colors.surfaceContainerHighest,
          borderRadius: const BorderRadius.all(UxnanRadius.full),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.donut_large_outlined,
              size: 13,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(width: UxnanSpacing.xs),
            Text(
              label,
              style: UxnanTypography.codeSmall.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
