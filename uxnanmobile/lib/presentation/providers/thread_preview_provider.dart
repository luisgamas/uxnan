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

/// Identifies the preview to fetch: the thread, plus a revision that changes
/// whenever it gets new activity.
///
/// The revision is what makes the row keep up. A `FutureProvider` resolves once
/// per key and caches, so keying on the thread id alone would freeze the row on
/// whatever the agent said first — it would never see a later turn. Feeding the
/// thread's `lastActivity` in gives each turn its own key, and `autoDispose`
/// drops the previous one.
typedef ThreadPreviewKey = ({String threadId, int revision});

/// The last thing the agent actually said in the thread, collapsed to one line.
///
/// This is what the row shows when the agent is idle — the same thing the
/// desktop's agent card shows on its second line once a turn ends, so the two
/// apps read alike. `null` while there is nothing to show (a brand-new thread,
/// or a reply with no text), and the row falls back to the agent.
final threadPreviewProvider = FutureProvider.autoDispose
    .family<String?, ThreadPreviewKey>((ref, key) async {
  final repository = ref.watch(messageRepositoryProvider);
  final messages = await repository.getMessages(
    key.threadId,
    limit: _previewLookback,
  );
  // `getMessages` returns the newest N in ASCENDING order, so the latest reply
  // is at the END. Walking forward would pin the row to the agent's very first
  // answer and never update it again — which is exactly what it did.
  for (final message in messages.reversed) {
    if (message.role != MessageRole.assistant) continue;
    final preview = _previewOf(message);
    if (preview.isNotEmpty) return preview;
  }
  return null;
});

String _previewOf(Message message) =>
    railPreviewText(message, maxLength: _previewMaxLength);
