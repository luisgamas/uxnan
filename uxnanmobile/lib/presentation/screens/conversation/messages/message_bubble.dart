import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/composer_handoff_provider.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_content_view.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/image_thumb_strip.dart';
import 'package:uxnan/presentation/widgets/image_viewer_dialog.dart';

/// Side of a sent-attachment thumbnail above the user bubble — the size the
/// composer strip used to have, so a sent image stays a compact reference the
/// timeline can scroll past; tapping it opens the image full size.
const double _sentThumbSize = 72;

/// Renders a [Message] in the timeline, by role:
///
/// - **user** → a right-aligned rounded bubble (the only role with a bubble);
/// - **assistant** → a full-width, bubble-less structured turn
///   ([AssistantTurnView]: work log → prose → changed files → copy);
/// - **system / tool** → full-width banners (no bubble).
///
/// Dropping the bubble for agent output matches the design references and makes
/// the whole answer one clean selectable surface instead of many fragments.
class MessageBubble extends StatelessWidget {
  /// Creates a [MessageBubble].
  const MessageBubble({required this.message, this.onTapLink, super.key});

  /// The message to render.
  final Message message;

  /// Handles links rendered in assistant prose.
  final ValueChanged<String>? onTapLink;

  @override
  Widget build(BuildContext context) {
    return switch (message.role) {
      MessageRole.user => _UserBubble(message: message),
      MessageRole.assistant => AssistantTurnView(
          message: message,
          onTapLink: onTapLink,
        ),
      MessageRole.system ||
      MessageRole.tool =>
        _FullWidthBlocks(message: message),
    };
  }
}

/// The user's own message: a right-aligned primary-container bubble. Tapping
/// the bubble toggles a "Copy message" affordance below it (hidden by default),
/// mirroring the agent turn's copy action.
///
/// Attached images ride **above** the bubble as the same small thumbnail strip
/// the composer shows before sending — right-aligned, scrolling horizontally
/// when there are several — instead of blowing the bubble open from the inside.
/// Tapping one opens it full size.
///
/// Two delivery states change how it reads:
/// - **queued** — sent while the agent was busy and still waiting its turn. It
///   is drawn as a muted "ghost" with a cancel button in its corner, and says
///   where it sits in line. When the queue reaches it the bubble settles into
///   its normal tone, so the queue is seen moving rather than just reported.
/// - **cancelled** — taken off the queue before the agent saw it. The bubble
///   returns to normal with a warning-toned note under it: the message is part
///   of the record even though it was never sent.
class _UserBubble extends ConsumerStatefulWidget {
  const _UserBubble({required this.message});
  final Message message;

  @override
  ConsumerState<_UserBubble> createState() => _UserBubbleState();
}

class _UserBubbleState extends ConsumerState<_UserBubble> {
  bool _showCopy = false;
  bool _expanded = false;

  /// Set while an edit/cancel round-trip is in flight, so neither action can be
  /// fired twice before the bridge answers.
  bool _busy = false;

  String get _text => widget.message.contents
      .whereType<TextContent>()
      .map((t) => t.text)
      .where((t) => t.isNotEmpty)
      .join('\n\n');

  /// The message's attached images, shown above the bubble.
  List<ImageContent> get _images =>
      widget.message.contents.whereType<ImageContent>().toList();

  /// Content that is neither text nor an image — kept inside the bubble.
  List<MessageContent> get _otherBlocks => widget.message.contents
      .where((c) => c is! TextContent && c is! ImageContent)
      .toList();

  void _copy() {
    final l10n = AppLocalizations.of(context);
    unawaited(Clipboard.setData(ClipboardData(text: _text)));
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.conversationMessageCopied)));
  }

  /// **Edit** — withdraws the message from the queue and puts its text back in
  /// the composer to be rewritten. It leaves no trace in the timeline: the
  /// message is about to be re-typed, so a husk beside it would be noise.
  Future<void> _editQueued() async {
    if (_busy) return;
    setState(() => _busy = true);
    // No snackbar on the way out: it would cover the composer at exactly the
    // moment the user is meant to look at it, hiding the very text the action
    // just put there. The text appearing in the pill IS the confirmation, and
    // the Drafts pill appearing says the old draft was kept.
    await ref.read(composerHandoffsProvider.notifier).edit(
          threadId: widget.message.threadId,
          turnId: widget.message.turnId,
          text: _text,
        );
    // The bubble is gone on success, so guard before touching state.
    if (mounted) setState(() => _busy = false);
  }

  /// **Cancel** — drops the message from the queue and leaves it in the
  /// timeline marked as cancelled. Nothing goes back to the composer: this is
  /// the "I changed my mind" action, and the record of it is the point.
  Future<void> _cancelQueued() async {
    if (_busy) return;
    setState(() => _busy = true);
    await ref.read(threadManagerProvider).cancelQueuedTurn(
          widget.message.threadId,
          widget.message.turnId,
        );
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final maxWidth = MediaQuery.sizeOf(context).width * 0.82;
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final message = widget.message;
    // The BRIDGE owns the queue, so its state is what decides whether this is a
    // waiting message — not the locally-cached delivery state, which can lag a
    // reconnect or be stale after another device changed the queue. Falling
    // back to the local flag keeps the bubble right in the instant between
    // `turn/send` returning and the queue notification arriving.
    final queue = ref.watch(threadQueueForProvider(message.threadId));
    final queued = (message.turnId.isNotEmpty &&
            queue.turnIds.contains(message.turnId)) ||
        // The local echo covers the instant between `turn/send` returning and
        // the queue notification landing. `ThreadManager` clears it as soon as
        // the bridge says the message left the queue, so it cannot get stuck.
        message.deliveryState == MessageDeliveryState.queued;
    final cancelled = message.deliveryState == MessageDeliveryState.cancelled;
    final motion =
        reduceMotion ? Duration.zero : const Duration(milliseconds: 220);
    final images = _images;
    // An image-only message needs no bubble at all — the strip is the message.
    // A queued one always keeps its bubble: the edit/cancel actions live in the
    // bubble's corner, so dropping it would leave a waiting image unactionable.
    final hasBubble = _text.isNotEmpty || _otherBlocks.isNotEmpty || queued;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        if (images.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: UxnanSpacing.xs),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: maxWidth),
              child: Align(
                alignment: Alignment.centerRight,
                child: ImageThumbStrip(
                  key: const ValueKey('message-attachments'),
                  images: images,
                  size: _sentThumbSize,
                  onTap: (index) => unawaited(
                    showImageViewerDialog(
                      context,
                      images: images,
                      initialIndex: index,
                    ),
                  ),
                ),
              ),
            ),
          ),
        if (hasBubble)
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxWidth),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              // A waiting message is a pending action, not conversation:
              // tapping it must not open the copy affordance meant for
              // sent history.
              onTap:
                  queued ? null : () => setState(() => _showCopy = !_showCopy),
              child: Stack(
                children: [
                  // A queued bubble settles into its normal tone the instant
                  // the queue drains to it — the animation IS the feedback
                  // that the message finally went out.
                  AnimatedContainer(
                    duration: motion,
                    curve: Curves.easeOutCubic,
                    margin:
                        const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
                    padding: EdgeInsets.fromLTRB(
                      UxnanSpacing.md,
                      UxnanSpacing.sm,
                      // Room for the edit + cancel pair so neither ever sits on
                      // the text (2 × 28 dp + the gap between and after them).
                      queued ? _queuedActionsWidth : UxnanSpacing.md,
                      UxnanSpacing.sm,
                    ),
                    decoration: BoxDecoration(
                      // The soft "elevated" surface rather than the user's own
                      // primary tone: a waiting message should read as pending,
                      // not as something already said.
                      color: queued
                          ? colors.surfaceContainerHighest
                          : colors.primaryContainer,
                      border: queued
                          ? Border.all(color: colors.outlineVariant)
                          : null,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(14),
                        topRight: Radius.circular(14),
                        bottomLeft: Radius.circular(14),
                        bottomRight: Radius.circular(4),
                      ),
                    ),
                    child: AnimatedSize(
                      duration: motion,
                      curve: Curves.easeOutCubic,
                      alignment: Alignment.topRight,
                      child: AnimatedSwitcher(
                        duration: motion,
                        // Cross-fade the one-line preview into the full message
                        // rather than swapping them, so delivery reads as the
                        // bubble opening up instead of a different bubble.
                        switchInCurve: Curves.easeOutCubic,
                        switchOutCurve: Curves.easeOutCubic,
                        child: queued
                            // One line, ellipsized: a waiting message is a
                            // reminder of what is coming, not something
                            // to read.
                            ? Text(
                                _text,
                                key: const ValueKey('queued-preview'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyMedium
                                    ?.copyWith(color: colors.onSurfaceVariant),
                              )
                            : _UserMessageBody(
                                key: const ValueKey('delivered-body'),
                                message: message,
                                text: _text,
                                surface: colors.primaryContainer,
                                onSurface: colors.onPrimaryContainer,
                                expanded: _expanded,
                                onExpandedChanged: (value) =>
                                    setState(() => _expanded = value),
                              ),
                      ),
                    ),
                  ),
                  // The corner actions fade out with the queued state instead
                  // of vanishing the instant the message is delivered.
                  Positioned(
                    top: UxnanSpacing.sm,
                    right: UxnanSpacing.sm,
                    child: AnimatedOpacity(
                      duration: motion,
                      curve: Curves.easeOutCubic,
                      opacity: queued ? 1 : 0,
                      child: IgnorePointer(
                        ignoring: !queued,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // Edit first (reading order): the recoverable
                            // action sits before the one that ends the
                            // message.
                            _QueuedActionButton(
                              icon: Icons.edit_outlined,
                              tooltip: l10n.queuedMessageEdit,
                              busy: _busy,
                              onTap: _editQueued,
                            ),
                            const SizedBox(width: UxnanSpacing.xs),
                            _QueuedActionButton(
                              icon: Icons.close_rounded,
                              tooltip: l10n.queuedMessageCancel,
                              busy: _busy,
                              onTap: _cancelQueued,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        // The status line under the bubble grows/shrinks rather than snapping
        // between "waiting", "cancelled" and nothing at all.
        AnimatedSize(
          duration: motion,
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: queued
              ? _QueuedMessageNote(message: message)
              : cancelled
                  ? const _CancelledMessageNote()
                  : const SizedBox.shrink(),
        ),
        if (!queued && _showCopy && _text.isNotEmpty)
          _CopyMessageAction(onCopy: _copy),
      ],
    );
  }
}

/// Diameter of a queued bubble's corner action.
const double _queuedActionSize = 28;

/// Horizontal room the pair of corner actions needs inside the bubble, so the
/// preview text is padded away from them rather than running underneath.
const double _queuedActionsWidth =
    _queuedActionSize * 2 + UxnanSpacing.xs + UxnanSpacing.sm * 2;

/// One of a queued bubble's corner actions (edit / cancel). Both share the
/// shape so the pair reads as a single control group; the busy state is shown
/// on whichever was tapped, and disables both.
class _QueuedActionButton extends StatelessWidget {
  const _QueuedActionButton({
    required this.icon,
    required this.tooltip,
    required this.busy,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: colors.surfaceContainerLowest,
        shape: CircleBorder(side: BorderSide(color: colors.outlineVariant)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: busy ? null : onTap,
          child: SizedBox(
            width: _queuedActionSize,
            height: _queuedActionSize,
            child: busy
                ? Center(
                    child: PolygonLoader(
                      size: 14,
                      color: colors.onSurfaceVariant,
                      semanticsLabel: tooltip,
                    ),
                  )
                : Icon(icon, size: 16, color: colors.onSurfaceVariant),
          ),
        ),
      ),
    );
  }
}

/// Says where a queued message sits in line — "next" when it runs as soon as
/// the current turn ends, its position otherwise.
class _QueuedMessageNote extends ConsumerWidget {
  const _QueuedMessageNote({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final queue = ref.watch(threadQueueForProvider(message.threadId));
    final position = queue.positionOf(message.turnId);
    final label = switch (position) {
      null => l10n.queuedMessageWaiting,
      1 => l10n.queuedMessageNext,
      final other => l10n.queuedMessagePosition(other),
    };
    return Padding(
      padding: const EdgeInsets.only(
        right: UxnanSpacing.xs,
        bottom: UxnanSpacing.xs,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.schedule_rounded,
            size: 13,
            color: colors.onSurfaceVariant,
          ),
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            label,
            style:
                textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

/// Marks a message that was queued and taken back before the agent saw it.
class _CancelledMessageNote extends StatelessWidget {
  const _CancelledMessageNote();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.only(
        right: UxnanSpacing.xs,
        bottom: UxnanSpacing.xs,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.block_rounded,
            size: 13,
            color: UxnanColors.warning,
          ),
          const SizedBox(width: UxnanSpacing.xs),
          Text(
            l10n.cancelledMessage,
            style: textTheme.bodySmall?.copyWith(color: UxnanColors.warning),
          ),
        ],
      ),
    );
  }
}

/// User-message content with a responsive text preview. Only textual content
/// is clipped; the remaining blocks stay fully visible (images are lifted out
/// of the bubble by [_UserBubble]). The full source stays mounted and is always
/// used by the copy action.
class _UserMessageBody extends StatelessWidget {
  const _UserMessageBody({
    required this.message,
    required this.text,
    required this.surface,
    required this.onSurface,
    required this.expanded,
    required this.onExpandedChanged,
    super.key,
  });

  static const int _collapsedLines = 10;

  final Message message;
  final String text;

  /// The bubble's own background — the clipped-preview gradient fades into it,
  /// so a ghost bubble must not fade into the normal bubble's tone.
  final Color surface;

  /// Foreground used by the bubble's own controls (show more / show less).
  final Color onSurface;

  final bool expanded;
  final ValueChanged<bool> onExpandedChanged;

  bool _textExceedsPreview(BuildContext context, double width) {
    if (text.isEmpty || width <= 0) return false;
    final textTheme = Theme.of(context).textTheme;
    final painter = TextPainter(
      text: TextSpan(text: text, style: textTheme.bodyMedium),
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
      maxLines: _collapsedLines,
    )..layout(maxWidth: width);
    return painter.didExceedMaxLines;
  }

  double _previewHeight(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final linePainter = TextPainter(
      text: TextSpan(text: 'Ag', style: textTheme.bodyMedium),
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
    )..layout();
    return linePainter.preferredLineHeight * _collapsedLines;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // Images are rendered above the bubble, not in it.
    final nonText = message.contents
        .where((c) => c is! TextContent && c is! ImageContent)
        .toList();

    return LayoutBuilder(
      builder: (context, constraints) {
        final isLong = _textExceedsPreview(context, constraints.maxWidth);
        final collapse = isLong && !expanded;
        final textBlock = MessageContentView(
          content: TextContent(text),
          selectableText: false,
        );

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (text.isNotEmpty)
              if (collapse)
                SizedBox(
                  height: _previewHeight(context),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ClipRect(
                        child: SingleChildScrollView(
                          physics: const NeverScrollableScrollPhysics(),
                          child: textBlock,
                        ),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: UxnanSpacing.xl,
                        child: IgnorePointer(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                                colors: [
                                  surface.withValues(alpha: 0),
                                  surface,
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                )
              else
                textBlock,
            for (var index = 0; index < nonText.length; index++) ...[
              if (text.isNotEmpty || index > 0)
                const SizedBox(height: UxnanSpacing.sm),
              MessageContentView(
                content: nonText[index],
                selectableText: false,
              ),
            ],
            if (isLong) ...[
              const SizedBox(height: UxnanSpacing.xs),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => onExpandedChanged(!expanded),
                  icon: Icon(
                    expanded
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
                    size: 18,
                  ),
                  label: Text(
                    expanded
                        ? l10n.conversationShowLess
                        : l10n.conversationShowMore,
                  ),
                  style: TextButton.styleFrom(foregroundColor: onSurface),
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

/// The "Copy message" action revealed under a tapped user bubble — same style
/// as the agent turn's copy action, right-aligned.
class _CopyMessageAction extends StatelessWidget {
  const _CopyMessageAction({required this.onCopy});
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerRight,
      child: TextButton.icon(
        onPressed: onCopy,
        icon: const Icon(Icons.copy_rounded, size: 16),
        label: Text(l10n.conversationCopyMessage),
        style: TextButton.styleFrom(
          foregroundColor: colors.onSurfaceVariant,
          visualDensity: VisualDensity.compact,
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.sm,
            vertical: UxnanSpacing.xs,
          ),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
      ),
    );
  }
}

/// System / tool messages: full-width, no bubble.
class _FullWidthBlocks extends StatelessWidget {
  const _FullWidthBlocks({required this.message});
  final Message message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
      child: _Blocks(message: message),
    );
  }
}

/// The ordered content blocks of a [message], stacked with consistent spacing.
class _Blocks extends StatelessWidget {
  const _Blocks({required this.message});
  final Message message;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < message.contents.length; i++) ...[
          if (i > 0) const SizedBox(height: UxnanSpacing.sm),
          MessageContentView(
            content: message.contents[i],
          ),
        ],
      ],
    );
  }
}
