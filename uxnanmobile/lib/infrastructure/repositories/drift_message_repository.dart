import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/repositories/i_message_repository.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// drift-backed implementation of [IMessageRepository] (spec 02c §10.3).
///
/// Content blocks are stored as a JSON array in `contentsJson` via the
/// [MessageContent] codec.
class DriftMessageRepository implements IMessageRepository {
  /// Creates a [DriftMessageRepository] over the given database.
  const DriftMessageRepository(this._db);

  final UxnanDatabase _db;

  @override
  Future<List<Message>> getMessages(
    String threadId, {
    int? limit,
    String? beforeId,
  }) async {
    final query = _db.select(_db.messagesTable)
      ..where((m) => m.threadId.equals(threadId))
      ..orderBy([(m) => OrderingTerm.desc(m.orderIndex)]);

    if (beforeId != null) {
      final ref = await (_db.select(_db.messagesTable)
            ..where((m) => m.id.equals(beforeId)))
          .getSingleOrNull();
      if (ref != null) {
        query.where((m) => m.orderIndex.isSmallerThanValue(ref.orderIndex));
      }
    }
    if (limit != null) query.limit(limit);

    final rows = await query.get();
    // Stored DESC for pagination; return ascending for display.
    return rows.reversed.map(_rowToMessage).toList();
  }

  @override
  Future<void> saveMessage(Message message) async {
    await _db
        .into(_db.messagesTable)
        .insertOnConflictUpdate(_toCompanion(message));
  }

  @override
  Future<void> saveMessages(List<Message> messages) async {
    await _db.batch((batch) {
      batch.insertAllOnConflictUpdate(
        _db.messagesTable,
        messages.map(_toCompanion).toList(),
      );
    });
  }

  @override
  Stream<List<Message>> watchMessages(String threadId) {
    return (_db.select(_db.messagesTable)
          ..where((m) => m.threadId.equals(threadId))
          ..orderBy([(m) => OrderingTerm.asc(m.orderIndex)]))
        .watch()
        .map((rows) => rows.map(_rowToMessage).toList());
  }

  MessagesTableCompanion _toCompanion(Message message) {
    return MessagesTableCompanion(
      id: Value(message.id),
      threadId: Value(message.threadId),
      turnId: Value(message.turnId),
      role: Value(message.role.name),
      contentsJson: Value(
        jsonEncode(message.contents.map((c) => c.toJson()).toList()),
      ),
      deliveryState: Value(message.deliveryState.name),
      orderIndex: Value(message.orderIndex),
      fingerprint: Value(message.fingerprint),
      createdAtMs: Value(message.createdAt.millisecondsSinceEpoch),
    );
  }

  Message _rowToMessage(MessageRow row) {
    final decoded = jsonDecode(row.contentsJson);
    final contents = <MessageContent>[
      if (decoded is List)
        for (final c in decoded)
          MessageContent.fromJson((c as Map).cast<String, dynamic>()),
    ];
    return Message(
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      role: MessageRole.values.byName(row.role),
      contents: contents,
      deliveryState: MessageDeliveryState.values.byName(row.deliveryState),
      orderIndex: row.orderIndex,
      fingerprint: row.fingerprint,
      createdAt: DateTime.fromMillisecondsSinceEpoch(row.createdAtMs),
    );
  }
}
