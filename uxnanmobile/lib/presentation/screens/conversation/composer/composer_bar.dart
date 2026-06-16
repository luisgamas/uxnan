import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/core/extensions/string_ext.dart';
import 'package:uxnan/infrastructure/speech/speech_to_text_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The message composer — a Neural Expressive **floating pill** (guide §4.3):
/// a `surfaceContainerHighest` rounded surface holding just the essentials —
/// a "+" that opens the turn-tools sheet (attach + run options + approval), an
/// expandable text field, and a trailing mic/send/stop. The model picker and
/// context meter moved up to the app bar; the run-option/approval controls moved
/// into the "+" sheet, so the composer stays uncluttered.
class ComposerBar extends ConsumerStatefulWidget {
  /// Creates a [ComposerBar].
  const ComposerBar({
    required this.onSend,
    this.enabled = true,
    this.running = false,
    this.hasAttachments = false,
    this.onStop,
    this.onPlus,
    super.key,
  });

  /// Called with the trimmed message when the user sends.
  final ValueChanged<String> onSend;

  /// Whether sending is currently allowed (e.g. connected).
  final bool enabled;

  /// Whether the composer has pending attachments — lets the user send with an
  /// empty text field (image-only message) and shows Send instead of the mic.
  final bool hasAttachments;

  /// Whether the agent is currently producing a turn — Send becomes Stop.
  final bool running;

  /// Cancels the in-flight turn. Required when [running] is true.
  final VoidCallback? onStop;

  /// Opens the unified turn-tools sheet (attach + run options + approval). When
  /// null the "+" is hidden (the agent advertises no tools).
  final VoidCallback? onPlus;

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
    if (!widget.enabled) return;
    if (text.isEmpty && !widget.hasAttachments) return;
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
    final showSend = _hasText || widget.hasAttachments;
    final canSend = showSend && widget.enabled;

    return SafeArea(
      top: false,
      child: Center(
        child: ConstrainedBox(
          constraints:
              const BoxConstraints(maxWidth: UxnanSpacing.maxContentWidth),
          child: Padding(
            // Floating pill: gutter all around, lifted off the screen edge.
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.md,
            ),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.surfaceContainerHighest,
                // Fully rounded (pill) to match the other NE surfaces (model
                // pill, icon surfaces); grows into a capsule when multi-line.
                borderRadius: const BorderRadius.all(UxnanRadius.full),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.xs,
                  vertical: UxnanSpacing.xs,
                ),
                child: Row(
                  // crossAxisAlignment defaults to center, so the "+", the text
                  // field and the mic/send button share one baseline (they have
                  // different intrinsic heights); the field grows upward when
                  // multi-line.
                  children: [
                    // "+" opens the unified turn-tools sheet; hidden when the
                    // agent advertises no attach/run-options/approval tools.
                    if (widget.onPlus != null)
                      IconButton(
                        tooltip: l10n.composerTools,
                        visualDensity: VisualDensity.compact,
                        icon: Icon(
                          Icons.add_rounded,
                          size: 22,
                          color: colors.onSurfaceVariant,
                        ),
                        onPressed: widget.onPlus,
                      )
                    else
                      const SizedBox(width: UxnanSpacing.sm),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: UxnanSpacing.sm,
                        ),
                        child: TextField(
                          controller: _controller,
                          // Always editable so a message can be drafted while
                          // offline; only *sending* is gated by [enabled].
                          minLines: 1,
                          maxLines: 6,
                          style: textTheme.bodyMedium,
                          textInputAction: TextInputAction.newline,
                          decoration: InputDecoration(
                            isCollapsed: true,
                            border: InputBorder.none,
                            hintText: l10n.composerHint,
                            hintStyle:
                                TextStyle(color: colors.onSurfaceVariant),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    _TrailingAction(
                      hasText: showSend,
                      enabled: widget.enabled,
                      running: widget.running,
                      listening: _listening,
                      onSend: canSend ? _send : null,
                      onStop: widget.onStop,
                      onVoice: widget.enabled ? _toggleDictation : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The pill's trailing button: Stop while running, Send when there's text,
/// otherwise the mic (which toggles voice dictation).
class _TrailingAction extends StatelessWidget {
  const _TrailingAction({
    required this.hasText,
    required this.enabled,
    required this.running,
    required this.listening,
    required this.onSend,
    required this.onStop,
    required this.onVoice,
  });

  final bool hasText;
  final bool enabled;
  final bool running;
  final bool listening;
  final VoidCallback? onSend;
  final VoidCallback? onStop;
  final VoidCallback? onVoice;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);

    final Widget child;
    if (running) {
      child = IconButton.filled(
        key: const ValueKey('stop'),
        tooltip: l10n.composerStop,
        onPressed: onStop,
        style: IconButton.styleFrom(
          backgroundColor: colors.error,
          foregroundColor: colors.onError,
        ),
        icon: const Icon(Icons.stop_rounded),
      );
    } else if (hasText) {
      child = IconButton.filled(
        key: const ValueKey('send'),
        tooltip: l10n.composerSend,
        onPressed: onSend,
        icon: const Icon(Icons.arrow_upward_rounded),
      );
    } else {
      child = IconButton(
        key: const ValueKey('mic'),
        tooltip: listening ? l10n.composerVoiceStop : l10n.composerVoice,
        isSelected: listening,
        style: listening
            ? IconButton.styleFrom(
                backgroundColor: colors.errorContainer,
                foregroundColor: colors.onErrorContainer,
              )
            : null,
        icon: Icon(
          listening ? Icons.mic_rounded : Icons.mic_none_rounded,
          color: listening ? colors.onErrorContainer : colors.onSurfaceVariant,
        ),
        onPressed: onVoice,
      );
    }

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 180),
      transitionBuilder: (child, animation) =>
          ScaleTransition(scale: animation, child: child),
      child: child,
    );
  }
}
