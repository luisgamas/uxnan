import 'package:uxnan/domain/entities/message.dart';

/// Contract for persisting and observing [Message]s (spec 02a §5.1.4).
abstract class IMessageRepository {
  /// Returns messages for [threadId], most recent first, optionally [limit]ed
  /// and paginated with [beforeId] (messages ordered before that message).
  Future<List<Message>> getMessages(
    String threadId, {
    int? limit,
    String? beforeId,
  });

  /// Inserts or updates [message].
  Future<void> saveMessage(Message message);

  /// Inserts or updates [messages] in a single batch.
  Future<void> saveMessages(List<Message> messages);

  /// Emits the message list for [threadId] whenever it changes, ordered
  /// ascending by index.
  Stream<List<Message>> watchMessages(String threadId);
}
