import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/composer_handoff_provider.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_content_view.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/file_chip.dart';
import 'package:uxnan/presentation/widgets/image_thumb_strip.dart';
import 'package:uxnan/presentation/widgets/image_viewer_dialog.dart';
import 'package:uxnan/presentation/widgets/ne_dashed_outline.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

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
///
/// A message that reached the agent while it was still answering (steering)
/// reads as such from both sides: the reply it interrupted ends with a
/// "continues below" line ([Message.continuedIn]) — it is the answer so far,
/// not a closing one — and the user's message says it reached the agent while
/// it worked ([steered]).
class MessageBubble extends StatelessWidget {
  /// Creates a [MessageBubble].
  const MessageBubble({
    required this.message,
    this.onTapLink,
    this.steered = false,
    super.key,
  });

  /// The message to render.
  final Message message;

  /// Handles links rendered in assistant prose.
  final ValueChanged<String>? onTapLink;

  /// Whether this user message reached the agent while it was answering an
  /// earlier one: some turn's [Message.continuedIn] names this message's turn.
  /// Ignored for other roles.
  final bool steered;

  @override
  Widget build(BuildContext context) {
    return switch (message.role) {
      MessageRole.user => _UserBubble(message: message, steered: steered),
      MessageRole.assistant when message.continuedIn != null => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AssistantTurnView(message: message, onTapLink: onTapLink),
            const _ContinuesBelowNote(),
          ],
        ),
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
/// Its state changes how it reads:
/// - **queued** — sent while the agent was busy and still waiting its turn. The
///   timeline pins it below the conversation, in queue order, for as long as
///   it waits. It keeps the user's own tone and its whole text; only a dashed
///   outline says "not handed over yet". Its top-right corner carries **send
///   now** (which stops the running turn first, when one runs), **edit** and
///   **cancel** — the first queued message too — and a line under it says
///   where it sits in line. When the queue reaches
///   it the dashes and the actions fade and it drops into place where it was
///   delivered, so the queue is seen moving rather than just reported.
/// - **delivering** — still queued, but the step the agent was in ended and
///   the bridge is handing it over (the bridge's `deliveringTurnId`).
///   It keeps the dashes and its place; the actions go (the bridge refuses
///   them now) and the line under it says it is reaching the agent.
/// - **cancelled** — taken off the queue before the agent saw it. The bubble
///   returns to normal with a warning-toned note under it: the message is part
///   of the record even though it was never sent.
/// - **steered** — it reached the agent while it was still answering the
///   previous message, which was cut there. A note under it says so.
class _UserBubble extends ConsumerStatefulWidget {
  const _UserBubble({required this.message, required this.steered});
  final Message message;
  final bool steered;

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

  /// The message's attached files, shown as chips above the bubble.
  List<AttachedFileContent> get _files =>
      widget.message.contents.whereType<AttachedFileContent>().toList();

  /// Content that is neither text nor an attachment — kept inside the bubble.
  List<MessageContent> get _otherBlocks => widget.message.contents
      .where(
        (c) =>
            c is! TextContent &&
            c is! ImageContent &&
            c is! AttachedFileContent,
      )
      .toList();

  void _copy() {
    final l10n = AppLocalizations.of(context);
    unawaited(Clipboard.setData(ClipboardData(text: _text)));
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.conversationMessageCopied)));
  }

  /// **Edit** — withdraws the message from the queue and puts it back in the
  /// composer to be rewritten: its text and its images and files. It leaves no
  /// trace in the timeline: the message is about to be re-typed, so a husk
  /// beside it would be noise.
  Future<void> _editQueued() async {
    if (_busy) return;
    setState(() => _busy = true);
    // Read before the await: a successful edit removes this bubble.
    final messenger = ScaffoldMessenger.of(context);
    final failedText = AppLocalizations.of(context).queuedMessageRecoverFailed;
    // No snackbar on success: it would cover the composer at exactly the
    // moment the user is meant to look at it, hiding the very text the action
    // just put there. The text appearing in the pill IS the confirmation, and
    // the Drafts pill appearing says the old draft was kept.
    final outcome = await ref.read(composerHandoffsProvider.notifier).edit(
          threadId: widget.message.threadId,
          turnId: widget.message.turnId,
          text: _text,
          images: _images,
          files: _files,
        );
    if (outcome == RecoverOutcome.failed) {
      // Nothing visibly happened, so the refusal needs saying: the message is
      // still queued and nothing moved to the composer.
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(failedText)));
    }
    // The bubble is gone on success, so guard before touching state.
    if (mounted) setState(() => _busy = false);
  }

  /// **Send now** — the message goes as the next turn instead of waiting its
  /// turn. With nothing running (a held queue) it starts at once; while a turn
  /// runs the bridge stops that turn first and runs this message as soon as
  /// the stop lands, for every agent. A refusal says why; the message stays
  /// queued.
  Future<void> _sendNow() async {
    if (_busy) return;
    setState(() => _busy = true);
    final refused = await ref.read(threadManagerProvider).sendQueuedNow(
          widget.message.threadId,
          widget.message.turnId,
        );
    if (!mounted) return;
    setState(() => _busy = false);
    if (refused != null) {
      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(refused)));
    }
  }

  /// Whether a turn runs on the thread, which decides what "send now" says:
  /// while one runs it stops the agent first, so the action says that.
  bool _turnRunning(String threadId) =>
      ref.watch(threadActivityForProvider(threadId)) == ThreadActivity.running;

  /// **Cancel** — drops the message from the queue and leaves it in the
  /// timeline marked as cancelled. Nothing goes back to the composer: this is
  /// the "I changed my mind" action, and the record of it is the point.
  Future<void> _cancelQueued() async {
    if (_busy) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final failedText = AppLocalizations.of(context).queuedMessageCancelFailed;
    final cancelled = await ref.read(threadManagerProvider).cancelQueuedTurn(
          widget.message.threadId,
          widget.message.turnId,
        );
    if (!cancelled) {
      // The message is still queued and will run: say so, or the tap looks
      // like it did nothing.
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(failedText)));
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final maxWidth = MediaQuery.sizeOf(context).width * 0.82;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
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
    // The agent's step ended and the bridge is handing this one over: it stays
    // in the queue until the agent reads it, but it is no longer the user's to
    // edit, cancel or send — the bridge refuses all three — so it shows no
    // actions. Every other queued message, the first included, keeps them.
    final delivering = queued &&
        message.turnId.isNotEmpty &&
        queue.isDelivering(message.turnId);
    final actionable = queued && !delivering;
    // Send now is offered on every actionable message; while a turn runs it
    // stops the agent first, and its label says so. Read only for an
    // actionable one: every sent one would otherwise watch the thread's
    // activity for nothing.
    final sendNowStops = actionable && _turnRunning(message.threadId);
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
                  threadId: message.threadId,
                  size: _sentThumbSize,
                  onTap: (index) => unawaited(
                    showImageViewerDialog(
                      context,
                      images: images,
                      threadId: message.threadId,
                      initialIndex: index,
                    ),
                  ),
                ),
              ),
            ),
          ),
        if (_files.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: UxnanSpacing.xs),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: maxWidth),
              child: Wrap(
                key: const ValueKey('message-files'),
                alignment: WrapAlignment.end,
                spacing: UxnanSpacing.sm,
                runSpacing: UxnanSpacing.sm,
                children: [for (final file in _files) FileChip(file: file)],
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
                  // The dashes ARE the queued state: the bubble keeps the
                  // user's own tone and its whole message, and only its edge
                  // says "not handed over yet". The outline goes transparent
                  // on delivery, dissolving in place — the message never
                  // changes colour or moves, it just stops being provisional.
                  //
                  // The dashes are the bubble's OWN border, not an overlay: an
                  // overlay is drawn around the whole box, margin included, so
                  // it sat off the bubble and read as a second rectangle on top
                  // of it. As part of the decoration it is stroked on exactly
                  // the shape being filled.
                  AnimatedContainer(
                    duration: motion,
                    curve: Curves.easeOutCubic,
                    margin:
                        const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
                    padding: EdgeInsets.fromLTRB(
                      UxnanSpacing.md,
                      UxnanSpacing.sm,
                      // Room for every corner action shown (send now, edit,
                      // cancel), so none of them ever sits on the text.
                      actionable ? _queuedActionsWidth(3) : UxnanSpacing.md,
                      UxnanSpacing.sm,
                    ),
                    // Never shorter than the corner actions plus their inset
                    // (they sit [UxnanSpacing.xs] inside the top edge), so a
                    // small text scale cannot push them past the bottom edge.
                    constraints: BoxConstraints(
                      minHeight: actionable
                          ? _queuedActionSize + UxnanSpacing.xs * 2
                          : 0,
                    ),
                    decoration: ShapeDecoration(
                      color: colors.primaryContainer,
                      shape: NeDashedBorder(
                        borderRadius: _bubbleRadius,
                        side: BorderSide(
                          color: queued ? colors.primary : Colors.transparent,
                          width: 1.5,
                        ),
                      ),
                    ),
                    child: AnimatedSize(
                      duration: motion,
                      curve: Curves.easeOutCubic,
                      alignment: Alignment.topRight,
                      child: _UserMessageBody(
                        key: const ValueKey('user-body'),
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
                  // The corner actions fade out with the queued state instead
                  // of vanishing the instant the message is delivered (or the
                  // agent starts taking it).
                  Positioned(
                    top: UxnanSpacing.sm,
                    right: UxnanSpacing.sm,
                    child: AnimatedOpacity(
                      duration: motion,
                      curve: Curves.easeOutCubic,
                      opacity: actionable ? 1 : 0,
                      child: IgnorePointer(
                        ignoring: !actionable,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _QueuedActionButton(
                              icon: UxIcons.arrowUpward,
                              tooltip: sendNowStops
                                  ? l10n.queuedSendNowStopping
                                  : l10n.queuedMessageSendNow,
                              busy: _busy,
                              onTap: _sendNow,
                            ),
                            const SizedBox(width: UxnanSpacing.xs),
                            // Edit first (reading order): the recoverable
                            // action sits before the one that ends the
                            // message.
                            _QueuedActionButton(
                              icon: UxIcons.edit,
                              tooltip: l10n.queuedMessageEdit,
                              busy: _busy,
                              onTap: _editQueued,
                            ),
                            const SizedBox(width: UxnanSpacing.xs),
                            _QueuedActionButton(
                              icon: UxIcons.close,
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
              ? _QueuedMessageNote(message: message, delivering: delivering)
              : cancelled
                  ? const _CancelledMessageNote()
                  : widget.steered
                      ? const _SteeredMessageNote()
                      : const SizedBox.shrink(),
        ),
        if (!queued && _showCopy && _text.isNotEmpty)
          _CopyMessageAction(onCopy: _copy),
      ],
    );
  }
}

/// The user bubble's shape, shared by its fill and its queued dashed outline so
/// the dashes trace the bubble exactly.
const BorderRadius _bubbleRadius = BorderRadius.only(
  topLeft: Radius.circular(14),
  topRight: Radius.circular(14),
  bottomLeft: Radius.circular(14),
  bottomRight: Radius.circular(4),
);

/// Diameter of a queued bubble's corner action.
const double _queuedActionSize = 28;

/// Horizontal room [count] corner actions need inside the bubble — the buttons,
/// the gaps between them, their inset from the edge and a gap before the text —
/// so the text is padded away from them rather than running underneath.
double _queuedActionsWidth(int count) =>
    _queuedActionSize * count +
    UxnanSpacing.xs * (count - 1) +
    UxnanSpacing.sm * 2;

/// One of a queued bubble's corner actions (send now / edit / cancel). They
/// share the shape so the row reads as a single control group; the busy state
/// is shown on every one, and disables them all.
class _QueuedActionButton extends StatelessWidget {
  const _QueuedActionButton({
    required this.icon,
    required this.tooltip,
    required this.busy,
    required this.onTap,
  });

  final UxIconData icon;
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
                : UxIcon(icon, size: 16, color: colors.onSurfaceVariant),
          ),
        ),
      ),
    );
  }
}

/// Says where a queued message sits in line — "next" when it is the first to
/// go, its position otherwise — or, while the bridge hands it to the agent at
/// the end of its step, that it is reaching the agent.
class _QueuedMessageNote extends ConsumerWidget {
  const _QueuedMessageNote({required this.message, required this.delivering});

  final Message message;

  /// Whether the bridge is handing this message to the agent.
  final bool delivering;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final queue = ref.watch(threadQueueForProvider(message.threadId));
    final position = queue.positionOf(message.turnId);
    final label = delivering
        ? l10n.queuedDelivering
        : switch (position) {
            null => l10n.queuedMessageWaiting,
            1 => l10n.queuedMessageNext,
            final other => l10n.queuedMessagePosition(other),
          };
    return Padding(
      key: ValueKey(delivering ? 'queued-delivering-note' : 'queued-note'),
      padding: const EdgeInsets.only(
        right: UxnanSpacing.xs,
        bottom: UxnanSpacing.xs,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          // In motion while it reaches the agent; a clock while it waits.
          if (delivering)
            PolygonLoader(size: 13, color: colors.onSurfaceVariant)
          else
            UxIcon(
              UxIcons.schedule,
              size: 13,
              color: colors.onSurfaceVariant,
            ),
          const SizedBox(width: UxnanSpacing.xs),
          // Wraps rather than overflowing on a narrow phone or at a large
          // text scale.
          Flexible(
            child: Text(
              label,
              textAlign: TextAlign.end,
              style:
                  textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
            ),
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
          const UxIcon(
            UxIcons.block,
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

/// Marks a user message that reached the agent while it was still answering
/// the previous one: the agent took it into its running answer instead of
/// waiting for the end (steering).
class _SteeredMessageNote extends StatelessWidget {
  const _SteeredMessageNote();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _MessageNote(
      key: const ValueKey('steered-note'),
      icon: UxIcons.bolt,
      label: l10n.steeredMessage,
      alignment: MainAxisAlignment.end,
    );
  }
}

/// Closes a reply the user's next message interrupted: what it says is the
/// answer so far, and the agent went on answering below that message.
class _ContinuesBelowNote extends StatelessWidget {
  const _ContinuesBelowNote();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _MessageNote(
      key: const ValueKey('continues-below-note'),
      icon: UxIcons.arrowDownward,
      label: l10n.turnContinuesBelow,
      alignment: MainAxisAlignment.start,
    );
  }
}

/// A muted status line under a message: a small glyph and a label, in the
/// same tone and size as the queued and cancelled notes.
class _MessageNote extends StatelessWidget {
  const _MessageNote({
    required this.icon,
    required this.label,
    required this.alignment,
    super.key,
  });

  final UxIconData icon;
  final String label;

  /// `end` under a user bubble (right-aligned), `start` under a reply.
  final MainAxisAlignment alignment;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final end = alignment == MainAxisAlignment.end;
    return Padding(
      padding: EdgeInsets.only(
        // Under a reply, in line with the glyph of its "Copy response".
        left: end ? 0 : UxnanSpacing.sm,
        right: end ? UxnanSpacing.xs : 0,
        bottom: UxnanSpacing.xs,
      ),
      child: Row(
        mainAxisAlignment: alignment,
        mainAxisSize: MainAxisSize.min,
        children: [
          UxIcon(icon, size: 13, color: colors.onSurfaceVariant),
          const SizedBox(width: UxnanSpacing.xs),
          Flexible(
            child: Text(
              label,
              style:
                  textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
            ),
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
  /// so it must be the tone the bubble is actually drawn in.
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
                  icon: UxIcon(
                    expanded ? UxIcons.expandLess : UxIcons.expandMore,
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
        icon: const UxIcon(UxIcons.copy, size: 16),
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
