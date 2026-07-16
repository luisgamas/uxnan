import 'package:flutter/foundation.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/widgets/message_scroll_rail.dart';

/// The scroll-rail's derived view data for a conversation: one anchor per user
/// message, plus the lookups the screen needs to jump to a message and to
/// highlight the anchor currently on screen.
///
/// This is pure presentation view data derived from the domain [Message]
/// timeline — no Riverpod and no widget state — so [deriveRailAnchors] is
/// trivially unit-testable and the derivation can be memoized in a provider
/// instead of recomputed on every conversation rebuild.
@immutable
class RailAnchors {
  /// Creates rail anchors.
  const RailAnchors({
    required this.items,
    required this.messageIndices,
    required this.tickForId,
  });

  /// No anchors — fewer than the rail needs, or no timeline yet.
  static const RailAnchors empty = RailAnchors(
    items: [],
    messageIndices: [],
    tickForId: {},
  );

  /// One entry per user message, in order — the rail's ticks.
  final List<MessageScrollRailItem> items;

  /// The index into the full message list for each tick (same order as
  /// [items]), so a picked tick maps back to its message.
  final List<int> messageIndices;

  /// Tick ordinal per user-message id, for the rail's "you are here" highlight.
  final Map<String, int> tickForId;
}

/// Derives [RailAnchors] from a conversation's [messages]: one anchor per user
/// message, previewing the user's own text and the turn's final assistant
/// reply. Pure and side-effect-free.
RailAnchors deriveRailAnchors(List<Message> messages) {
  final items = <MessageScrollRailItem>[];
  final messageIndices = <int>[];
  final tickForId = <String, int>{};
  for (var i = 0; i < messages.length; i++) {
    final message = messages[i];
    if (message.role != MessageRole.user) continue;
    tickForId[message.id] = items.length;
    messageIndices.add(i);
    items.add(
      MessageScrollRailItem(
        preview: railPreviewText(message, maxLength: 140),
        secondaryPreview: _assistantReplyText(messages, i),
      ),
    );
  }
  return RailAnchors(
    items: items,
    messageIndices: messageIndices,
    tickForId: tickForId,
  );
}

/// A collapsed, single-line preview of a message's text (falling back to its
/// plain-text projection), truncated to [maxLength].
String railPreviewText(Message message, {required int maxLength}) {
  final text = message.contents
      .whereType<TextContent>()
      .map((t) => t.text)
      .where((t) => t.trim().isNotEmpty)
      .join(' ');
  final base = text.isEmpty ? message.plainText : text;
  final collapsed = base.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return '${collapsed.substring(0, maxLength).trimRight()}…';
}

/// The final assistant reply text within the turn that follows the user message
/// at [userIndex] (scanning until the next user message), or null.
String? _assistantReplyText(List<Message> messages, int userIndex) {
  String? last;
  for (var j = userIndex + 1; j < messages.length; j++) {
    if (messages[j].role == MessageRole.user) break;
    if (messages[j].role != MessageRole.assistant) continue;
    final text = railPreviewText(messages[j], maxLength: 220);
    if (text.isNotEmpty) last = text;
  }
  return last;
}
