import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/infrastructure/storage/approval_response_store.dart';

void main() {
  group('ApprovalResponseStore', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('returns null when no decision has been recorded for an approvalId',
        () async {
      final store = ApprovalResponseStore();
      final read = await store.read('ap-1');
      expect(read, isNull);
    });

    test('round-trips a recorded decision and read returns it back', () async {
      final store = ApprovalResponseStore();
      await store.record(
        approvalId: 'ap-1',
        decision: 'approve',
        decidedAtMs: 1700000000000,
      );
      final read = await store.read('ap-1');
      expect(read, isNotNull);
      expect(read!.decision, 'approve');
      expect(read.decidedAtMs, 1700000000000);
    });

    test('records persist across store instances (simulates app restart)',
        () async {
      // First "session" writes a decision.
      final writer = ApprovalResponseStore();
      await writer.record(
        approvalId: 'ap-restart',
        decision: 'approveSession',
        decidedAtMs: 1700000001234,
      );
      // A brand-new store (what the next app launch creates) reads it back.
      final reader = ApprovalResponseStore();
      final read = await reader.read('ap-restart');
      expect(read, isNotNull);
      expect(read!.decision, 'approveSession');
      expect(read.decidedAtMs, 1700000001234);
    });

    test('record is idempotent on a repeated identical decision', () async {
      final store = ApprovalResponseStore();
      await store.record(
        approvalId: 'ap-dup',
        decision: 'reject',
        decidedAtMs: 100,
      );
      // Same decision again should not overwrite the original timestamp.
      await store.record(
        approvalId: 'ap-dup',
        decision: 'reject',
        decidedAtMs: 999,
      );
      final read = await store.read('ap-dup');
      expect(read!.decidedAtMs, 100, reason: 'idempotent: timestamp must stay');
    });

    test('readAll returns every persisted decision in one shot', () async {
      final store = ApprovalResponseStore();
      await store.record(approvalId: 'a', decision: 'approve', decidedAtMs: 1);
      await store.record(approvalId: 'b', decision: 'reject', decidedAtMs: 2);
      await store.record(
        approvalId: 'c',
        decision: 'approveSession',
        decidedAtMs: 3,
      );
      final all = await store.readAll();
      expect(all.length, 3);
      expect(all['a']!.decision, 'approve');
      expect(all['b']!.decision, 'reject');
      expect(all['c']!.decision, 'approveSession');
    });

    test('forget removes a single decision without touching the others',
        () async {
      final store = ApprovalResponseStore();
      await store.record(approvalId: 'a', decision: 'approve', decidedAtMs: 1);
      await store.record(approvalId: 'b', decision: 'reject', decidedAtMs: 2);
      await store.forget('a');
      final all = await store.readAll();
      expect(all.length, 1);
      expect(all.containsKey('a'), isFalse);
      expect(all['b']!.decision, 'reject');
    });

    test('forget on a missing id is a silent no-op', () async {
      final store = ApprovalResponseStore();
      await store.record(approvalId: 'a', decision: 'approve', decidedAtMs: 1);
      await store.forget('does-not-exist');
      final all = await store.readAll();
      expect(all.length, 1);
    });

    test('a corrupt blob reads as empty (defensive against migration damage)',
        () async {
      SharedPreferences.setMockInitialValues({
        'uxnan.approval.responses': 'this-is-not-json',
      });
      final store = ApprovalResponseStore();
      final all = await store.readAll();
      expect(all, isEmpty);
    });

    test('skips entries with the wrong shape (forward-compat)', () async {
      SharedPreferences.setMockInitialValues({
        'uxnan.approval.responses':
            '{"good":{"decision":"approve","decidedAtMs":1},'
            '"bad":"oops","missing-decision":{"decidedAtMs":2}}',
      });
      final store = ApprovalResponseStore();
      final all = await store.readAll();
      expect(all.length, 1);
      expect(all['good']!.decision, 'approve');
    });
  });
}
