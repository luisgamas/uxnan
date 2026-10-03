import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// The trusted devices table exactly as schemas v5–v11 created it. Every
/// upgrade to v12 rewrites it, so a database from any of those versions has
/// it.
const _trustedDevicesV11 = 'CREATE TABLE "trusted_devices_table" ( '
    '"mac_device_id" TEXT NOT NULL, '
    '"display_name" TEXT NOT NULL, "relay_url" TEXT NOT NULL, '
    '"hosts" TEXT NULL, "session_id" TEXT NOT NULL, '
    '"paired_at_ms" INTEGER NOT NULL, "last_seen_ms" INTEGER NULL, '
    '"last_applied_bridge_outbound_seq" INTEGER NULL, '
    'PRIMARY KEY ("mac_device_id"))';

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
            ..execute(_trustedDevicesV11)
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

  test('a v10 database gains the turn duration column and keeps its messages',
      () async {
    // The messages table exactly as schema v10 created it, with one row.
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
              '"continued_in" TEXT NULL, '
              'PRIMARY KEY ("id"))',
            )
            ..execute(
              'INSERT INTO messages_table '
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                'old',
                'th1',
                't1',
                'assistant',
                '[{"type":"text","text":"done"}]',
                'delivered',
                1,
                null,
                1000,
                't2',
              ],
            )
            ..execute(_trustedDevicesV11)
            ..execute('PRAGMA user_version = 10');
        },
      ),
    );
    addTearDown(legacy.close);
    final legacyRepo = DriftMessageRepository(legacy);

    final before = await legacyRepo.getMessages('th1');
    expect(before.single.continuedIn, 't2');
    expect(before.single.turnDuration, isNull);

    await legacyRepo.saveMessage(
      before.single.copyWith(turnDuration: const Duration(seconds: 352)),
    );
    expect(
      (await legacyRepo.getMessages('th1')).single.turnDuration,
      const Duration(seconds: 352),
    );
  });

  test("a v11 database drops the shared relay's URL and keeps the PC",
      () async {
    // The trusted devices table exactly as schema v11 created it, with a PC
    // paired through the retired shared relay.
    final legacy = UxnanDatabase.forTesting(
      NativeDatabase.memory(
        setup: (raw) {
          raw
            ..execute(_trustedDevicesV11)
            ..execute(
              'INSERT INTO trusted_devices_table '
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [
                'mac-1',
                'Studio',
                'wss://relay.uxnan.io',
                '192.168.1.5:19850',
                's1',
                1000,
                2000,
                7,
              ],
            )
            ..execute('PRAGMA user_version = 11');
        },
      ),
    );
    addTearDown(legacy.close);

    final row = await legacy.select(legacy.trustedDevicesTable).getSingle();
    expect(row.displayName, 'Studio');
    expect(row.hosts, '192.168.1.5:19850');
    expect(row.lastAppliedBridgeOutboundSeq, 7);
    expect(row.relayUrl, isNull);
    expect(row.relayRoutingId, isNull);
    expect(row.relayEnabled, isFalse);
  });
}
