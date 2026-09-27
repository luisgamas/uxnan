import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// Which image of which conversation: the key of [messageAttachmentProvider].
typedef MessageAttachmentKey = ({String threadId, String attachmentId});

/// The bytes of an image a user message carries that the bridge keeps with the
/// message (`ImageContent.attachmentId`) — a message sent from another device,
/// or one read back from history. Fetched through [ThreadManager], which keeps
/// recent ones, so scrolling back and forth does not ask again; null when the
/// bridge cannot hand it over now.
final messageAttachmentProvider =
    FutureProvider.autoDispose.family<Uint8List?, MessageAttachmentKey>(
  (ref, key) => ref
      .read(threadManagerProvider)
      .loadAttachment(key.threadId, key.attachmentId),
);
