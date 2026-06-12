import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/core/extensions/string_ext.dart';
import 'package:uxnan/infrastructure/speech/speech_to_text_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/screens/conversation/session_environment.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// The message composer: a Material 3 bottom bar **anchored to the screen
/// edge** (not a floating card) — a `surfaceContainer` surface with a top
/// hairline that reads as chrome, holding an expandable text field and a
/// toolbar (attach, model selector, context usage, voice, send). The mic
/// dictates into the field via on-device speech-to-text; attach is still a
/// placeholder (FOR-DEV).
class ComposerBar extends ConsumerStatefulWidget {
  /// Creates a [ComposerBar].
  const ComposerBar({
    required this.onSend,
    required this.environment,
    this.resolvedModel,
    this.onModelTap,
    this.enabled = true,
    this.showAttach = true,
    this.showOptionsToggle = false,
    this.optionsVisible = true,
    this.onToggleOptions,
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

  /// Whether to show the toggle that collapses/expands the run-option and
  /// approval-mode strip above the composer. Hidden when there's nothing to
  /// toggle (the agent advertises no run options and no approvals).
  final bool showOptionsToggle;

  /// Whether the options strip is currently expanded (drives the toggle icon).
  final bool optionsVisible;

  /// Toggles the options strip. Required when [showOptionsToggle] is true.
  final VoidCallback? onToggleOptions;

  @override
  ConsumerState<ComposerBar> createState() => _ComposerBarState();
}

class _ComposerBarState extends ConsumerState<ComposerBar> {
  final TextEditingController _controller = TextEditingController();
  bool _hasText = false;

  /// Whether a voice-dictation session is currently active.
  bool _listening = false;

  /// The composer text captured when dictation started; recognized words are
  /// appended to it so dictation never clobbers what the user already typed.
  String _dictationBase = '';

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    // Best-effort: stop any active dictation when the composer goes away.
    if (_listening) ref.read(speechToTextServiceProvider).cancel();
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

  /// Starts or stops voice dictation. Recognized words stream into the field
  /// live; tapping again (or a final result) stops the session.
  Future<void> _toggleDictation() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final service = ref.read(speechToTextServiceProvider);

    if (_listening) {
      await service.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }

    final available = await service.initialize();
    if (!available) {
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.composerVoiceUnavailable)));
      return;
    }

    _dictationBase = _controller.text;
    await service.start(onResult: _onSpeechResult);
    if (mounted) setState(() => _listening = true);
  }

  void _onSpeechResult(SpeechResult result) {
    final base = _dictationBase;
    final joiner = base.isEmpty || base.endsWith(' ') ? '' : ' ';
    final text = '$base$joiner${result.text}';
    _controller
      ..text = text
      ..selection = TextSelection.collapsed(offset: text.length);
    // The session ends on a final result; reflect that in the mic state.
    if (result.isFinal) {
      _dictationBase = text;
      if (mounted) setState(() => _listening = false);
    }
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
        // The surface spans full width (chrome); its content centers within the
        // max content width so it lines up with the messages on wide screens.
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: UxnanSpacing.maxContentWidth,
            ),
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
                      // Collapse/expand the run-option + approval strip above the
                      // composer, shown only when there's something to toggle.
                      if (widget.showOptionsToggle) ...[
                        _RoundIconButton(
                          icon: widget.optionsVisible
                              ? Icons.tune_rounded
                              : Icons.tune_outlined,
                          tooltip: widget.optionsVisible
                              ? l10n.composerOptionsHide
                              : l10n.composerOptionsShow,
                          selected: widget.optionsVisible,
                          onPressed: widget.onToggleOptions,
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
                      // Context usage (usage-reporting agents): a percent ring
                      // when the window is known (Claude), else a raw token
                      // count (Codex). Shown at 0 until the first turn reports.
                      if (widget.environment.showContext) ...[
                        if (widget.environment.hasContext)
                          _ContextBadge(
                            percent: widget.environment.contextPercent,
                          )
                        else
                          _TokenChip(
                            label: widget.environment.contextTokensLabel ?? '0',
                          ),
                        const SizedBox(width: UxnanSpacing.xs),
                      ],
                      // Voice dictation: tap to start/stop. Recording shows a
                      // filled mic on an error-toned chip.
                      _RoundIconButton(
                        icon: _listening
                            ? Icons.mic_rounded
                            : Icons.mic_none_rounded,
                        tooltip: _listening
                            ? l10n.composerVoiceStop
                            : l10n.composerVoice,
                        selected: _listening,
                        selectedForeground: colors.onErrorContainer,
                        selectedBackground: colors.errorContainer,
                        onPressed: widget.enabled ? _toggleDictation : null,
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
    this.selected = false,
    this.selectedForeground,
    this.selectedBackground,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  /// When true, the button reads as "on" (a soft container tint) — used for the
  /// options-strip toggle and the active voice-dictation state.
  final bool selected;

  /// Foreground/background tints when [selected]; default to the secondary
  /// container pair (the mic overrides them with error tones while recording).
  final Color? selectedForeground;
  final Color? selectedBackground;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final foreground = selectedForeground ?? colors.onSecondaryContainer;
    final background = selectedBackground ?? colors.secondaryContainer;
    return IconButton(
      tooltip: tooltip,
      visualDensity: VisualDensity.compact,
      isSelected: selected,
      style: selected
          ? IconButton.styleFrom(
              backgroundColor: background,
              foregroundColor: foreground,
            )
          : null,
      icon: Icon(
        icon,
        size: 20,
        color: selected ? foreground : colors.onSurfaceVariant,
      ),
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
