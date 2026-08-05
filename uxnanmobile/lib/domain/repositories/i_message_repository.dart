import 'package:uxnan/domain/entities/message.dart';

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
  Future<List<Message>> getMessages(
    String threadId, {
    int? limit,
    String? beforeId,
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
  Stream<List<Message>> watchMessages(String threadId);
}
