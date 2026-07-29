import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_content_view.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
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
  const MessageBubble({required this.message, super.key});

  /// The message to render.
  final Message message;

  @override
  Widget build(BuildContext context) {
    return switch (message.role) {
      MessageRole.user => _UserBubble(message: message),
      MessageRole.assistant => AssistantTurnView(message: message),
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
class _UserBubble extends StatefulWidget {
  const _UserBubble({required this.message});
  final Message message;

  @override
  State<_UserBubble> createState() => _UserBubbleState();
}

class _UserBubbleState extends State<_UserBubble> {
  bool _showCopy = false;
  bool _expanded = false;

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

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final maxWidth = MediaQuery.sizeOf(context).width * 0.82;
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final images = _images;
    // An image-only message needs no bubble at all — the strip is the message.
    final hasBubble = _text.isNotEmpty || _otherBlocks.isNotEmpty;

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
              onTap: () => setState(() => _showCopy = !_showCopy),
              child: Container(
                margin: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.md,
                  vertical: UxnanSpacing.sm,
                ),
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(14),
                    topRight: Radius.circular(14),
                    bottomLeft: Radius.circular(14),
                    bottomRight: Radius.circular(4),
                  ),
                ),
                child: AnimatedSize(
                  duration: reduceMotion
                      ? Duration.zero
                      : const Duration(milliseconds: 220),
                  curve: Curves.easeOutCubic,
                  alignment: Alignment.topRight,
                  child: _UserMessageBody(
                    message: widget.message,
                    text: _text,
                    expanded: _expanded,
                    onExpandedChanged: (value) =>
                        setState(() => _expanded = value),
                  ),
                ),
              ),
            ),
          ),
        if (_showCopy && _text.isNotEmpty) _CopyMessageAction(onCopy: _copy),
      ],
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
    required this.expanded,
    required this.onExpandedChanged,
  });

  static const int _collapsedLines = 10;

  final Message message;
  final String text;
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
    final colors = Theme.of(context).colorScheme;
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
                                  colors.primaryContainer.withValues(alpha: 0),
                                  colors.primaryContainer,
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
                  style: TextButton.styleFrom(
                    foregroundColor: colors.onPrimaryContainer,
                  ),
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
