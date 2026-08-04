import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/providers/rail_anchors.dart';

/// How much of the reply a thread row can show before it truncates anyway.
const int _previewMaxLength = 120;

/// How many messages to look back through for the latest assistant reply.
///
/// Small on purpose: this runs once per visible row, and the reply we want is
/// at the very end of the thread. A handful covers the trailing tool/system
/// messages that can sit after it.
const int _previewLookback = 8;

/// The last thing the agent actually said in [threadId], collapsed to one line.
///
/// This is what the thread row shows when the agent is idle — the same thing
/// the desktop's agent card shows on its second line once a turn ends, so the
/// two apps read alike. `null` while there is nothing to show (a brand-new
/// thread, or a reply with no text), and the row falls back to the agent.
final threadPreviewProvider =
    FutureProvider.autoDispose.family<String?, String>((ref, threadId) async {
  final repository = ref.watch(messageRepositoryProvider);
  final messages = await repository.getMessages(
    threadId,
    limit: _previewLookback,
  );
  // `getMessages` returns most-recent-first, so the first assistant message
  // with text IS the latest reply.
  for (final message in messages) {
    if (message.role != MessageRole.assistant) continue;
    final preview = _previewOf(message);
    if (preview.isNotEmpty) return preview;
  }
  return null;
});

String _previewOf(Message message) =>
    railPreviewText(message, maxLength: _previewMaxLength);
