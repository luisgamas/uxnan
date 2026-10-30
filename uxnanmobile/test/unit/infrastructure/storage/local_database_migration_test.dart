import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/conversation_transfer.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
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

/// The messages table exactly as schemas v11 and v12 created it.
const _messagesV11 = 'CREATE TABLE "messages_table" ("id" TEXT NOT NULL, '
    '"thread_id" TEXT NOT NULL, "turn_id" TEXT NOT NULL, '
    '"role" TEXT NOT NULL, "contents_json" TEXT NOT NULL, '
    '"delivery_state" TEXT NOT NULL, "order_index" INTEGER NOT NULL, '
    '"fingerprint" TEXT NULL, "created_at_ms" INTEGER NOT NULL, '
    '"continued_in" TEXT NULL, "turn_duration_ms" INTEGER NULL, '
    'PRIMARY KEY ("id"))';

/// The trusted devices table as schema v12 created it.
const _trustedDevicesV12 = 'CREATE TABLE "trusted_devices_table" ( '
    '"mac_device_id" TEXT NOT NULL, '
    '"display_name" TEXT NOT NULL, '
    '"hosts" TEXT NULL, "session_id" TEXT NOT NULL, '
    '"paired_at_ms" INTEGER NOT NULL, "last_seen_ms" INTEGER NULL, '
    '"last_applied_bridge_outbound_seq" INTEGER NULL, '
    '"relay_url" TEXT NULL, "relay_routing_id" TEXT NULL, '
    '"relay_enabled" INTEGER NOT NULL DEFAULT 0 '
    'CHECK ("relay_enabled" IN (0, 1)), '
    'PRIMARY KEY ("mac_device_id"))';

/// The threads table exactly as schemas v7–v13 created it. Every upgrade to
/// v14 adds a column to it, so a database from any of those versions has it.
const _threadsV13 = 'CREATE TABLE "threads_table" ("id" TEXT NOT NULL, '
    '"title" TEXT NOT NULL, "project_id" TEXT NULL, "device_id" TEXT NULL, '
    '"cwd" TEXT NULL, "worktree_path" TEXT NULL, "agent_id" TEXT NOT NULL, '
    '"model" TEXT NULL, "sync_state" TEXT NOT NULL, "status" TEXT NOT NULL, '
    '"last_activity_ms" INTEGER NULL, "created_at_ms" INTEGER NOT NULL, '
    '"origin_kind" TEXT NULL, "origin_name" TEXT NULL, PRIMARY KEY ("id"))';

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
            ..execute(_threadsV13)
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
            ..execute(_threadsV13)
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
            ..execute(_threadsV13)
            ..execute(_messagesV11)
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

  test('a v12 database gains the reply preview, filled from its text runs',
      () async {
    final legacy = UxnanDatabase.forTesting(
      NativeDatabase.memory(
        setup: (raw) {
          void insert(String id, String role, String contents) => raw.execute(
                'INSERT INTO messages_table '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                  id,
                  'th1',
                  't1',
                  role,
                  contents,
                  'delivered',
                  1,
                  null,
                  1000,
                  null,
                  null,
                ],
              );
          raw
            ..execute(_messagesV11)
            ..execute(_trustedDevicesV12)
            ..execute(_threadsV13);
          insert(
            'a',
            'assistant',
            jsonEncode([
              {'type': 'thinking', 'text': 'hidden'},
              {'type': 'text', 'text': 'Let me look.'},
              {'type': 'command_execution', 'command': 'ls'},
              {'type': 'text', 'text': '  '},
              {'type': 'text', 'text': 'Done.'},
            ]),
          );
          insert('b', 'assistant', 'not json');
          raw.execute('PRAGMA user_version = 12');
        },
      ),
    );
    addTearDown(legacy.close);

    final rows = await legacy.select(legacy.messagesTable).get();
    final byId = {for (final row in rows) row.id: row.previewText};
    expect(byId['a'], 'Let me look. Done.');
    expect(byId['b'], isNull);
    expect(
      await DriftMessageRepository(legacy).latestReplyPreview('th1'),
      'Let me look. Done.',
    );
  });

  test(
      'a v13 database gains the thread continuity column and keeps its '
      'threads', () async {
    final legacy = UxnanDatabase.forTesting(
      NativeDatabase.memory(
        setup: (raw) {
          raw
            ..execute(_threadsV13)
            ..execute(
              _messagesV11.replaceFirst(
                '"turn_duration_ms" INTEGER NULL, ',
                '"turn_duration_ms" INTEGER NULL, "preview_text" TEXT NULL, ',
              ),
            )
            ..execute(_trustedDevicesV12)
            ..execute(
              'INSERT INTO threads_table (id, title, agent_id, sync_state, '
              'status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)',
              ['th1', 'Old', 'codex', 'synced', 'active', 1000],
            )
            ..execute('PRAGMA user_version = 13');
        },
      ),
    );
    addTearDown(legacy.close);
    final repo = DriftThreadRepository(legacy);

    final before = await repo.getThread('th1');
    expect(before?.title, 'Old');
    expect(before?.transfer, isNull);
    expect(before?.continuations, isEmpty);

    const transfer = ConversationTransfer(
      id: 'x1',
      strategy: TransferStrategy.selection,
      sourceThreadId: 'src',
      sourceTitle: 'Source',
      sourceAgentId: 'claude-code',
      status: TransferStatus.delivered,
      turnId: 't1',
      context: TransferContextSummary(
        turns: 3,
        omittedTurns: 1,
        bytes: 900,
        approxTokens: 225,
      ),
    );
    const continuation = ThreadContinuation(
      threadId: 'next',
      transferId: 'x2',
      agentId: 'pi-agent',
      strategy: TransferStrategy.reference,
    );
    await repo.saveThread(
      before!.copyWith(transfer: transfer, continuations: [continuation]),
    );
    final after = await repo.getThread('th1');
    expect(after?.transfer, transfer);
    expect(after?.continuations, [continuation]);
  });
}
