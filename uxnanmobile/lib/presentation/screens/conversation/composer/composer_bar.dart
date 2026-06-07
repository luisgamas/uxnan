import 'package:flutter/material.dart';
import 'package:uxnan/core/extensions/string_ext.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// The floating message composer: a rounded, elevated card with an expandable
/// text field and a toolbar (attach, model, context, voice, send). Attach and
/// voice are placeholders (FOR-DEV).
class ComposerBar extends StatefulWidget {
  /// Creates a [ComposerBar].
  const ComposerBar({
    required this.onSend,
    required this.environment,
    this.enabled = true,
    super.key,
  });

  /// Called with the trimmed message when the user sends.
  final ValueChanged<String> onSend;

  /// The session environment (model, context) shown in the toolbar.
  final SessionEnvironment environment;

  /// Whether sending is currently allowed (e.g. connected).
  final bool enabled;

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
    final l10n = AppLocalizations.of(context);
    final canSend = _hasText && widget.enabled;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          UxnanSpacing.md,
          UxnanSpacing.sm,
          UxnanSpacing.md,
          UxnanSpacing.lg,
        ),
        child: Container(
          decoration: BoxDecoration(
            color: colors.surfaceContainerHigh,
            borderRadius: const BorderRadius.all(Radius.circular(24)),
            border: Border.all(color: colors.outline.withValues(alpha: 0.6)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.18),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
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
                style: Theme.of(context).textTheme.bodyMedium,
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
                  // FOR-DEV: attach is a placeholder (no file/image picker yet).
                  _RoundIconButton(
                    icon: Icons.add_rounded,
                    tooltip: l10n.composerAttach,
                    onPressed: null,
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  Flexible(
                    child: _ModelChip(model: widget.environment.modelName),
                  ),
                  const Spacer(),
                  // The badge is hidden until the bridge reports real token
                  // usage (no fabricated percentage).
                  if (widget.environment.hasContext) ...[
                    _ContextBadge(percent: widget.environment.contextPercent),
                    const SizedBox(width: UxnanSpacing.xs),
                  ],
                  // FOR-DEV: voice input is a placeholder (no speech-to-text).
                  _RoundIconButton(
                    icon: Icons.mic_none_rounded,
                    tooltip: l10n.composerVoice,
                    onPressed: null,
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  _SendButton(enabled: canSend, onPressed: _send),
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

class _ModelChip extends StatelessWidget {
  const _ModelChip({required this.model});
  final String model;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerHighest,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: () {}, // FOR-DEV: model selector.
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.md,
            vertical: UxnanSpacing.sm,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.auto_awesome,
                size: 14,
                color: UxnanColors.claudeCodeAgent,
              ),
              const SizedBox(width: UxnanSpacing.xs),
              Flexible(
                child: Text(
                  model,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
              Icon(
                Icons.expand_more_rounded,
                size: 16,
                color: colors.onSurfaceVariant,
              ),
            ],
          ),
        ),
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

class _SendButton extends StatelessWidget {
  const _SendButton({required this.enabled, required this.onPressed});
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final bg = enabled
        ? colors.primary
        : colors.onSurfaceVariant.withValues(alpha: 0.25);
    return Material(
      color: bg,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: enabled ? onPressed : null,
        child: Padding(
          padding: const EdgeInsets.all(UxnanSpacing.sm),
          child: Icon(
            Icons.arrow_upward_rounded,
            size: 20,
            color: enabled ? colors.onPrimary : colors.surface,
          ),
        ),
      ),
    );
  }
}
