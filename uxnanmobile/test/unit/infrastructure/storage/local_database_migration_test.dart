import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// Upgrades of an existing on-device database (`UxnanDatabase.migration`).
void main() {
  test('a v9 database gains the continuedIn column and keeps its messages',
      () async {
    // The messages table exactly as schema v9 created it, with one row.
    final legacy = UxnanDatabase.forTesting(
      NativeDatabase.memory(
        setup: (raw) {
          raw
            ..execute(
              'CREATE TABLE "messages_table" ("id" TEXT NOT NULL, '
              '"thread_id" TEXT NOT NULL, "turn_id" TEXT NOT NULL, '
              '"role" TEXT NOT NULL, "contents_json" TEXT NOT NULL, '
              '"delivery_state" TEXT NOT NULL, "order_index" INTEGER NOT NULL, '
              '"fingerprint" TEXT NULL, "created_at_ms" INTEGER NOT NULL, '
              'PRIMARY KEY ("id"))',
            )
            ..execute(
              'INSERT INTO messages_table VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                'old',
                'th1',
                't1',
                'user',
                '[{"type":"text","text":"hi"}]',
                'sent',
                1,
                null,
                1000,
              ],
            )
            ..execute('PRAGMA user_version = 9');
        },
      ),
    );
    addTearDown(legacy.close);
    final legacyRepo = DriftMessageRepository(legacy);

    final before = await legacyRepo.getMessages('th1');
    expect(before.single.id, 'old');
    expect(before.single.continuedIn, isNull);

    await legacyRepo.saveMessage(before.single.copyWith(continuedIn: 't2'));
    expect((await legacyRepo.getMessages('th1')).single.continuedIn, 't2');
  });
}
