import 'package:drift/drift.dart';

/// drift table backing messages within a thread (spec 02c section 10.1).
@DataClassName('MessageRow')
@TableIndex(name: 'idx_messages_thread_id', columns: {#threadId, #orderIndex})
class MessagesTable extends Table {
  /// Unique message id (primary key).
  TextColumn get id => text()();

  /// Owning thread id.
  TextColumn get threadId => text()();

  /// Owning turn id.
  TextColumn get turnId => text()();

  /// `MessageRole` serialized as its enum name.
  TextColumn get role => text()();

  /// `List<MessageContent>` serialized as JSON.
  TextColumn get contentsJson => text()();

  /// `MessageDeliveryState` serialized as its enum name.
  TextColumn get deliveryState => text()();

  /// Monotonic ordering index within the thread.
  IntColumn get orderIndex => integer()();

  /// Content fingerprint used for deduplication, if computed.
  TextColumn get fingerprint => text().nullable()();

  /// Creation timestamp in epoch milliseconds.
  IntColumn get createdAtMs => integer()();

  @override
  Set<Column> get primaryKey => {id};
}
