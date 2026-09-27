import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/providers/message_attachment_provider.dart';

/// The bytes of one message image, whichever way they are had: inline (a
/// message this phone sent, or one being written), or kept by the bridge and
/// fetched on demand (`ImageContent.attachmentId`).
///
/// [builder] gets the bytes, or null with `loading` telling a fetch still under
/// way apart from an image that cannot be shown.
class MessageImageBytes extends ConsumerStatefulWidget {
  /// Creates a [MessageImageBytes].
  const MessageImageBytes({
    required this.image,
    required this.builder,
    this.threadId,
    super.key,
  });

  /// The image to show.
  final ImageContent image;

  /// The conversation the message belongs to; needed for a bridge-kept image.
  final String? threadId;

  /// Draws the image from its bytes.
  final Widget Function(
    BuildContext context,
    Uint8List? bytes, {
    required bool loading,
  }) builder;

  @override
  ConsumerState<MessageImageBytes> createState() => _MessageImageBytesState();
}

class _MessageImageBytesState extends ConsumerState<MessageImageBytes> {
  Uint8List? _inline;

  @override
  void initState() {
    super.initState();
    _decode();
  }

  @override
  void didUpdateWidget(MessageImageBytes oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.image.base64Data != widget.image.base64Data) _decode();
  }

  /// Decoded once per image, not on every rebuild: the strip lives in a
  /// scrolling timeline.
  void _decode() {
    final data = widget.image.base64Data;
    if (data == null) {
      _inline = null;
      return;
    }
    try {
      _inline = base64Decode(data);
    } on FormatException {
      _inline = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final inline = _inline;
    if (inline != null) return widget.builder(context, inline, loading: false);
    final attachmentId = widget.image.attachmentId;
    final threadId = widget.threadId;
    if (attachmentId == null || threadId == null) {
      return widget.builder(context, null, loading: false);
    }
    final fetched = ref.watch(
      messageAttachmentProvider(
        (threadId: threadId, attachmentId: attachmentId),
      ),
    );
    return widget.builder(
      context,
      fetched.value,
      loading: fetched.isLoading,
    );
  }
}
