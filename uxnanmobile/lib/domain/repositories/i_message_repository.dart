import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';

/// Contract for persisting and observing [Message]s (spec 02a §5.1.4).
abstract class IMessageRepository {
  /// Returns messages for [threadId] in **ascending** order (oldest first),
  /// optionally [limit]ed and paginated with [beforeId] (messages ordered
  /// before that message).
  ///
  /// [limit] selects the **newest** N — the query pages from the end — but the
  /// list it returns is still oldest-first, ready to render. So the LATEST
  /// message is `.last`, not `.first`; reading it as most-recent-first is a
  /// silent bug (it was, in the thread row's reply preview).
  ///
  /// [states] keeps only messages in those delivery states (the queued ones a
  /// queue reconcile settles, without reading the rest of the thread).
  Future<List<Message>> getMessages(
    String threadId, {
    int? limit,
    String? beforeId,
    Set<MessageDeliveryState>? states,
  });

  /// Inserts or updates [message].
  Future<void> saveMessage(Message message);

  /// Inserts or updates [messages] in a single batch.
  Future<void> saveMessages(List<Message> messages);

  /// Removes the message with [id], if present.
  ///
  /// Deliberately narrow: the timeline is a record, so the only thing ever
  /// really deleted is a message **taken back before the agent saw it** —
  /// pulling a queued message into the composer to edit it, where leaving a
  /// husk behind would be noise the user then has to clean up.
  Future<void> deleteMessage(String id);

  /// Emits the message list for [threadId] whenever it changes, ordered
  /// ascending by index.
  ///
  /// [limit] keeps only the **newest** N (still oldest-first). The open
  /// conversation watches just the window it renders: the store re-runs a
  /// watched query on every write to the table — any thread's — and each row
  /// decodes its contents, so watching a whole long thread re-decoded all of
  /// it on every message saved anywhere.
  Stream<List<Message>> watchMessages(String threadId, {int? limit});

  /// The turn ids [threadId]'s messages belong to (the empty id of a local echo
  /// not yet stamped included), read without decoding any contents.
  Future<Set<String>> turnIdsOf(String threadId);

  /// The messages of [threadId] that belong to any of [turnIds], plus — when
  /// [includeUnstamped] — the local echoes not yet stamped with a turn,
  /// ascending by index. What a sync reconciles against: the turns of the page
  /// it received, never the whole thread.
  Future<List<Message>> getMessagesForTurns(
    String threadId,
    Set<String> turnIds, {
    bool includeUnstamped = false,
  });

  /// The messages of [threadId] at or after [fromOrderIndex], ascending.
  Future<List<Message>> getMessagesFrom(
    String threadId, {
    required int fromOrderIndex,
  });

  /// The lowest and highest `orderIndex` in [threadId]; `null` when it holds
  /// no messages.
  Future<({int min, int max})?> orderBounds(String threadId);
}
