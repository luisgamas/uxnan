import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_content_view.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

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
class _UserBubble extends StatefulWidget {
  const _UserBubble({required this.message});
  final Message message;

  @override
  State<_UserBubble> createState() => _UserBubbleState();
}

class _UserBubbleState extends State<_UserBubble> {
  bool _showCopy = false;

  String get _text => widget.message.contents
      .whereType<TextContent>()
      .map((t) => t.text)
      .where((t) => t.isNotEmpty)
      .join('\n\n');

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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
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
              // Non-selectable so the tap toggles the copy action (the button
              // replaces the need to hand-select the text).
              child: _Blocks(message: widget.message, selectable: false),
            ),
          ),
        ),
        if (_showCopy && _text.isNotEmpty) _CopyMessageAction(onCopy: _copy),
      ],
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
  const _Blocks({required this.message, this.selectable = true});
  final Message message;

  /// Whether text blocks are selectable (false for the user's own bubble).
  final bool selectable;

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
            selectableText: selectable,
          ),
        ],
      ],
    );
  }
}
