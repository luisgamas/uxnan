import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:uxnan/domain/value_objects/inline_attachments.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/theme/markdown.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/attachment_chip.dart';
import 'package:uxnan/presentation/widgets/attachment_sheet.dart';
import 'package:uxnan/presentation/widgets/image_viewer_dialog.dart';

/// The Markdown tag an attachment marker parses into.
const String _chipTag = 'uxattachment';

/// A sent user message as it was written: its Markdown text with each image
/// and file drawn as an [AttachmentChip] at its marker, inside the sentence —
/// the same chips the composer showed, so the message reads the same before
/// and after it is sent, and the same as the desktop draws it.
///
/// Attachments past the text's markers (a message stored before markers
/// existed) are shown after the text; a marker with no attachment draws
/// nothing. Tapping an image chip opens the message's images full size;
/// tapping a file chip shows its name, size and type.
class UserMessageText extends StatelessWidget {
  /// Creates a [UserMessageText].
  const UserMessageText({
    required this.text,
    required this.attachments,
    this.threadId,
    super.key,
  });

  /// The message text, one attachment marker per chip.
  final String text;

  /// The message's images and files, in marker order.
  final List<AttachmentContent> attachments;

  /// The conversation, for attachments the bridge keeps.
  final String? threadId;

  void _open(BuildContext context, int index) {
    final attachment = attachments[index];
    if (attachment is ImageContent) {
      final images = attachments.whereType<ImageContent>().toList();
      unawaited(
        showImageViewerDialog(
          context,
          images: images,
          threadId: threadId,
          initialIndex: images.indexOf(attachment),
        ),
      );
      return;
    }
    unawaited(
      showAttachmentSheet(context, attachment: attachment, threadId: threadId),
    );
  }

  Widget _chip(BuildContext context, int index) => AttachmentChip(
        key: ValueKey('message-chip-$index'),
        attachment: attachments[index],
        threadId: threadId,
        tone: AttachmentChipTone.bubble,
        onTap: () => _open(context, index),
      );

  @override
  Widget build(BuildContext context) {
    final markers = countAttachmentMarkers(text);
    final hasWords = stripAttachmentMarkers(text).trim().isNotEmpty;
    final body = text.trim().isEmpty
        ? null
        : MarkdownBody(
            data: text,
            styleSheet: uxnanMarkdownStyleSheet(context),
            inlineSyntaxes: [_AttachmentMarkerSyntax()],
            builders: {
              _chipTag: _AttachmentChipBuilder(
                count: attachments.length,
                chip: (index) => _chip(context, index),
              ),
            },
          );
    final extra = [
      for (var i = markers; i < attachments.length; i++) _chip(context, i),
    ];
    if (extra.isEmpty) return body ?? const SizedBox.shrink();
    final trailing = Wrap(
      key: const ValueKey('message-extra-chips'),
      spacing: UxnanSpacing.xs,
      runSpacing: UxnanSpacing.xs,
      children: extra,
    );
    if (body == null) return trailing;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        body,
        SizedBox(height: hasWords ? UxnanSpacing.sm : UxnanSpacing.xs),
        trailing,
      ],
    );
  }
}

/// Each attachment marker, numbered in reading order — the order of the
/// message's attachments.
class _AttachmentMarkerSyntax extends md.InlineSyntax {
  _AttachmentMarkerSyntax()
      : super(
          kAttachmentMarker,
          startCharacter: kAttachmentMarker.codeUnitAt(0),
        );

  int _next = 0;

  @override
  bool onMatch(md.InlineParser parser, Match match) {
    parser.addNode(
      md.Element.empty(_chipTag)..attributes['index'] = '${_next++}',
    );
    return true;
  }
}

/// Draws a marker's chip inline: a `WidgetSpan` in the paragraph's own
/// `Text.rich`, so the words wrap around it.
class _AttachmentChipBuilder extends MarkdownElementBuilder {
  _AttachmentChipBuilder({required this.count, required this.chip});

  final int count;
  final Widget Function(int index) chip;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final index = int.tryParse(element.attributes['index'] ?? '') ?? -1;
    return Text.rich(
      WidgetSpan(
        alignment: PlaceholderAlignment.middle,
        child: index >= 0 && index < count
            ? Padding(
                padding: const EdgeInsets.symmetric(vertical: 1),
                child: chip(index),
              )
            : const SizedBox.shrink(),
      ),
    );
  }
}
