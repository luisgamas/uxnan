import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uxnan/core/extensions/enum_ext.dart';
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
    Set<MessageDeliveryState>? states,
  }) async {
    final query = _db.select(_db.messagesTable)
      ..where((m) => m.threadId.equals(threadId))
      ..orderBy([(m) => OrderingTerm.desc(m.orderIndex)]);
    if (states != null) {
      query.where(
        (m) => m.deliveryState.isIn([for (final state in states) state.name]),
      );
    }

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
  Future<void> deleteMessage(String id) async {
    await (_db.delete(_db.messagesTable)..where((m) => m.id.equals(id))).go();
  }

  @override
  Stream<List<Message>> watchMessages(String threadId, {int? limit}) {
    if (limit == null) {
      return (_db.select(_db.messagesTable)
            ..where((m) => m.threadId.equals(threadId))
            ..orderBy([(m) => OrderingTerm.asc(m.orderIndex)]))
          .watch()
          .map((rows) => rows.map(_rowToMessage).toList());
    }
    // Newest N, read from the end and handed back oldest-first.
    return (_db.select(_db.messagesTable)
          ..where((m) => m.threadId.equals(threadId))
          ..orderBy([(m) => OrderingTerm.desc(m.orderIndex)])
          ..limit(limit))
        .watch()
        .map((rows) => rows.reversed.map(_rowToMessage).toList());
  }

  @override
  Future<Set<String>> turnIdsOf(String threadId) async {
    final query = _db.selectOnly(_db.messagesTable, distinct: true)
      ..addColumns([_db.messagesTable.turnId])
      ..where(_db.messagesTable.threadId.equals(threadId));
    final rows = await query.get();
    return {
      for (final row in rows) row.read(_db.messagesTable.turnId) ?? '',
    };
  }

  @override
  Future<List<Message>> getMessagesForTurns(
    String threadId,
    Set<String> turnIds, {
    bool includeUnstamped = false,
  }) async {
    final wanted = {...turnIds, if (includeUnstamped) ''};
    if (wanted.isEmpty) return const [];
    final rows = await (_db.select(_db.messagesTable)
          ..where((m) => m.threadId.equals(threadId) & m.turnId.isIn(wanted))
          ..orderBy([(m) => OrderingTerm.asc(m.orderIndex)]))
        .get();
    return rows.map(_rowToMessage).toList();
  }

  @override
  Future<List<Message>> getMessagesFrom(
    String threadId, {
    required int fromOrderIndex,
  }) async {
    final rows = await (_db.select(_db.messagesTable)
          ..where(
            (m) =>
                m.threadId.equals(threadId) &
                m.orderIndex.isBiggerOrEqualValue(fromOrderIndex),
          )
          ..orderBy([(m) => OrderingTerm.asc(m.orderIndex)]))
        .get();
    return rows.map(_rowToMessage).toList();
  }

  @override
  Future<({int min, int max})?> orderBounds(String threadId) async {
    final lowest = _db.messagesTable.orderIndex.min();
    final highest = _db.messagesTable.orderIndex.max();
    final row = await (_db.selectOnly(_db.messagesTable)
          ..addColumns([lowest, highest])
          ..where(_db.messagesTable.threadId.equals(threadId)))
        .getSingle();
    final min = row.read(lowest);
    final max = row.read(highest);
    if (min == null || max == null) return null;
    return (min: min, max: max);
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
      continuedIn: Value(message.continuedIn),
      turnDurationMs: Value(message.turnDuration?.inMilliseconds),
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
      // Decoded tolerantly: a row written by a build that knew an extra enum
      // value (a feature branch, a downgrade after a rollback) must not take
      // the timeline down. An unknown role reads as a neutral system block and
      // an unknown delivery state as `delivered` — the row exists, so the
      // honest default is "it is in the history", never "it failed".
      role: MessageRole.values.byNameOr(row.role, MessageRole.system),
      contents: contents,
      deliveryState: MessageDeliveryState.values
          .byNameOr(row.deliveryState, MessageDeliveryState.delivered),
      orderIndex: row.orderIndex,
      fingerprint: row.fingerprint,
      createdAt: DateTime.fromMillisecondsSinceEpoch(row.createdAtMs),
      continuedIn: row.continuedIn,
      turnDuration: row.turnDurationMs == null
          ? null
          : Duration(milliseconds: row.turnDurationMs!),
    );
  }
}
