import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/infrastructure/storage/question_response_store.dart';

void main() {
  group('QuestionResponseStore', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('returns null when no answer has been recorded for a questionId',
        () async {
      final store = QuestionResponseStore();
      final read = await store.read('qst-1');
      expect(read, isNull);
    });

    test('round-trips recorded answers and read returns them back', () async {
      final store = QuestionResponseStore();
      await store.record(
        questionId: 'qst-1',
        answers: [
          ['Dart'],
          ['A', 'B'],
        ],
        answeredAtMs: 1700000000000,
      );
      final read = await store.read('qst-1');
      expect(read, isNotNull);
      expect(read!.answers, [
        ['Dart'],
        ['A', 'B'],
      ]);
      expect(read.answeredAtMs, 1700000000000);
    });

    test('an empty inner list (a skipped question) round-trips', () async {
      final store = QuestionResponseStore();
      await store.record(
        questionId: 'qst-skip',
        answers: [<String>[]],
        answeredAtMs: 42,
      );
      final read = await store.read('qst-skip');
      expect(read!.answers, [<String>[]]);
    });

    test('records persist across store instances (simulates app restart)',
        () async {
      final writer = QuestionResponseStore();
      await writer.record(
        questionId: 'qst-restart',
        answers: [
          ['Python'],
        ],
        answeredAtMs: 1700000001234,
      );
      final reader = QuestionResponseStore();
      final read = await reader.read('qst-restart');
      expect(read, isNotNull);
      expect(read!.answers, [
        ['Python'],
      ]);
      expect(read.answeredAtMs, 1700000001234);
    });

    test('record overwrites a previous answer idempotently', () async {
      final store = QuestionResponseStore();
      await store.record(
        questionId: 'qst-dup',
        answers: [
          ['A'],
        ],
        answeredAtMs: 100,
      );
      await store.record(
        questionId: 'qst-dup',
        answers: [
          ['B'],
        ],
        answeredAtMs: 999,
      );
      final read = await store.read('qst-dup');
      expect(read!.answers, [
        ['B'],
      ]);
      expect(read.answeredAtMs, 999);
    });

    test('readAll returns every persisted answer in one shot', () async {
      final store = QuestionResponseStore();
      await store.record(
        questionId: 'a',
        answers: [
          ['x'],
        ],
        answeredAtMs: 1,
      );
      await store.record(
        questionId: 'b',
        answers: [<String>[]],
        answeredAtMs: 2,
      );
      final all = await store.readAll();
      expect(all.length, 2);
      expect(all['a']!.answers, [
        ['x'],
      ]);
      expect(all['b']!.answers, [<String>[]]);
    });

    test('forget removes a single answer without touching the others',
        () async {
      final store = QuestionResponseStore();
      await store.record(
        questionId: 'a',
        answers: [
          ['x'],
        ],
        answeredAtMs: 1,
      );
      await store.record(
        questionId: 'b',
        answers: [
          ['y'],
        ],
        answeredAtMs: 2,
      );
      await store.forget('a');
      final all = await store.readAll();
      expect(all.length, 1);
      expect(all.containsKey('a'), isFalse);
      expect(all['b']!.answers, [
        ['y'],
      ]);
    });

    test('forget on a missing id is a silent no-op', () async {
      final store = QuestionResponseStore();
      await store.record(
        questionId: 'a',
        answers: [
          ['x'],
        ],
        answeredAtMs: 1,
      );
      await store.forget('does-not-exist');
      final all = await store.readAll();
      expect(all.length, 1);
    });

    test('a corrupt blob reads as empty (defensive against migration damage)',
        () async {
      SharedPreferences.setMockInitialValues({
        'uxnan.question.responses': 'this-is-not-json',
      });
      final store = QuestionResponseStore();
      final all = await store.readAll();
      expect(all, isEmpty);
    });

    test('skips entries with the wrong shape (forward-compat)', () async {
      SharedPreferences.setMockInitialValues({
        'uxnan.question.responses':
            '{"good":{"answers":[["A"]],"answeredAtMs":1},'
                '"bad":"oops","missing-answers":{"answeredAtMs":2}}',
      });
      final store = QuestionResponseStore();
      final all = await store.readAll();
      expect(all.length, 1);
      expect(all['good']!.answers, [
        ['A'],
      ]);
    });
  });
}
