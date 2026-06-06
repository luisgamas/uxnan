import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';

/// An immutable snapshot of a thread's timeline (spec 02a §5.4.6).
///
/// The timeline never mutates a list in place; every operation returns a new
/// snapshot. Messages are kept sorted ascending by `orderIndex`. Streaming and
/// pagination are modeled here so the application layer can apply bridge events
/// deterministically.
///
/// Note: the spec places this type under `presentation/.../timeline/`; it lives
/// in `domain/value_objects/` because it is pure data + reducer logic produced
/// by the application layer (which cannot import presentation).
class TurnTimelineSnapshot extends Equatable {
  /// Creates a [TurnTimelineSnapshot].
  const TurnTimelineSnapshot({
    this.messages = const [],
    this.hasMore = false,
    this.nextCursor,
    this.streamingTurnId,
  });

  /// Messages in display order (ascending by `orderIndex`).
  final List<Message> messages;

  /// Whether older history can still be loaded.
  final bool hasMore;

  /// Pagination cursor for the next older page.
  final String? nextCursor;

  /// The turn currently streaming, or `null` if idle.
  final String? streamingTurnId;

  /// Whether a turn is streaming.
  bool get isStreaming => streamingTurnId != null;

  /// Returns a copy with the given fields replaced. [clearStreaming] forces
  /// [streamingTurnId] to `null`.
  TurnTimelineSnapshot copyWith({
    List<Message>? messages,
    bool? hasMore,
    String? nextCursor,
    String? streamingTurnId,
    bool clearStreaming = false,
  }) {
    return TurnTimelineSnapshot(
      messages: messages ?? this.messages,
      hasMore: hasMore ?? this.hasMore,
      nextCursor: nextCursor ?? this.nextCursor,
      streamingTurnId:
          clearStreaming ? null : (streamingTurnId ?? this.streamingTurnId),
    );
  }

  /// Merges [incoming] messages into the timeline, replacing any with the same
  /// id and inserting the rest, then re-sorting by `orderIndex`.
  TurnTimelineSnapshot reconcile(List<Message> incoming) {
    final byId = {for (final m in messages) m.id: m};
    for (final m in incoming) {
      byId[m.id] = m;
    }
    return copyWith(messages: _sorted(byId.values));
  }

  /// Prepends an older [history] page (pagination), preserving current order.
  TurnTimelineSnapshot prependHistory(
    List<Message> history, {
    required bool hasMore,
    String? nextCursor,
  }) {
    final byId = {for (final m in history) m.id: m};
    for (final m in messages) {
      byId[m.id] = m;
    }
    return TurnTimelineSnapshot(
      messages: _sorted(byId.values),
      hasMore: hasMore,
      nextCursor: nextCursor,
      streamingTurnId: streamingTurnId,
    );
  }

  /// Starts streaming a turn, seeding it with [placeholder] (an assistant
  /// message with an empty streaming text block).
  TurnTimelineSnapshot startStreaming(Message placeholder) {
    return reconcile([placeholder]).copyWith(
      streamingTurnId: placeholder.turnId,
    );
  }

  /// Appends a streaming text [delta] to the streaming message of [turnId].
  TurnTimelineSnapshot appendStreamingDelta(String turnId, String delta) {
    final updated = [
      for (final m in messages)
        if (m.turnId == turnId && m.isStreaming)
          m.copyWith(contents: _appendText(m.contents, delta))
        else
          m,
    ];
    return copyWith(messages: updated);
  }

  /// Completes streaming for [turnId]. If [finalMessage] is given it replaces
  /// the streaming message; otherwise the streaming text is marked complete.
  TurnTimelineSnapshot completeStreaming(
    String turnId, {
    Message? finalMessage,
  }) {
    if (finalMessage != null) {
      return reconcile([finalMessage]).copyWith(clearStreaming: true);
    }
    final updated = [
      for (final m in messages)
        if (m.turnId == turnId && m.isStreaming)
          m.copyWith(contents: _finalizeText(m.contents))
        else
          m,
    ];
    return copyWith(messages: updated, clearStreaming: true);
  }

  static List<Message> _sorted(Iterable<Message> messages) {
    final list = messages.toList()
      ..sort((a, b) => a.orderIndex.compareTo(b.orderIndex));
    return list;
  }

  static List<MessageContent> _appendText(
    List<MessageContent> contents,
    String delta,
  ) {
    if (contents.isNotEmpty && contents.last is TextContent) {
      final last = contents.last as TextContent;
      return [
        ...contents.sublist(0, contents.length - 1),
        TextContent(last.text + delta, isStreaming: true),
      ];
    }
    return [...contents, TextContent(delta, isStreaming: true)];
  }

  static List<MessageContent> _finalizeText(List<MessageContent> contents) {
    return [
      for (final c in contents)
        if (c is TextContent) TextContent(c.text) else c,
    ];
  }

  @override
  List<Object?> get props => [messages, hasMore, nextCursor, streamingTurnId];
}
