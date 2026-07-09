import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// On-device store for the user's answers to agent question prompts.
///
/// Every time the user answers (or skips) a question card, the chosen answers
/// are persisted here (along with the `questionId` the bridge assigned). The
/// next time the same card scrolls into view — even after an app restart — the
/// card renders its **resolved** state showing the chosen labels, and the
/// options stay non-interactive, so an answered prompt is never re-answered.
///
/// The store is intentionally non-sensitive (answers are just the option
/// labels the agent already offered) and small (one entry per answered card),
/// so SharedPreferences is a clean fit and no SQLite migration is needed.
///
/// Key: `uxnan.question.responses` → a JSON map of
/// `{ questionId: { answers, answeredAtMs } }`, where `answers` is a list of
/// per-question chosen-label lists (empty for a skipped question).
class QuestionResponseStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  QuestionResponseStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _key = 'uxnan.question.responses';

  /// The persisted answers for [questionId], or null when the user has not
  /// answered it on this device yet. Resolves to `null` on the first read (the
  /// key is absent) and on any decode error (a corrupt blob is treated as "no
  /// history" rather than crashing the card).
  Future<({List<List<String>> answers, int answeredAtMs})?> read(
    String questionId,
  ) async {
    final all = await readAll();
    return all[questionId];
  }

  /// All persisted answers, keyed by `questionId`. Used by the provider to
  /// hydrate its in-memory map at startup. Always returns a fresh, mutable map
  /// so callers can `addAll`/`remove` without crashing on a shared
  /// unmodifiable view.
  Future<Map<String, ({List<List<String>> answers, int answeredAtMs})>>
      readAll() async {
    final prefs = await _prefs;
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) {
      return <String, ({List<List<String>> answers, int answeredAtMs})>{};
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        return <String, ({List<List<String>> answers, int answeredAtMs})>{};
      }
      final out = <String, ({List<List<String>> answers, int answeredAtMs})>{};
      for (final entry in decoded.entries) {
        if (entry.key is! String) continue;
        final v = entry.value;
        if (v is! Map) continue;
        final answersRaw = v['answers'];
        final answeredAtMs = v['answeredAtMs'];
        if (answersRaw is! List || answeredAtMs is! int) continue;
        final answers = <List<String>>[
          for (final group in answersRaw)
            if (group is List)
              <String>[
                for (final label in group)
                  if (label is String) label,
              ],
        ];
        out[entry.key as String] = (
          answers: answers,
          answeredAtMs: answeredAtMs,
        );
      }
      return out;
    } on Object {
      return <String, ({List<List<String>> answers, int answeredAtMs})>{};
    }
  }

  /// Persists [answers] for [questionId] with [answeredAtMs] (epoch ms). The
  /// record is overwritten idempotently on a repeated answer (a double-tap or
  /// a retry after a failed send just rewrites the same entry).
  Future<void> record({
    required String questionId,
    required List<List<String>> answers,
    required int answeredAtMs,
  }) async {
    final all = await readAll();
    all[questionId] = (answers: answers, answeredAtMs: answeredAtMs);
    await _writeAll(all);
  }

  /// Removes the persisted answers for [questionId] (used when a thread is
  /// deleted and its history is dropped — most callers just leave the entry).
  Future<void> forget(String questionId) async {
    final all = await readAll();
    if (!all.containsKey(questionId)) return;
    all.remove(questionId);
    await _writeAll(all);
  }

  Future<void> _writeAll(
    Map<String, ({List<List<String>> answers, int answeredAtMs})> all,
  ) async {
    final prefs = await _prefs;
    if (all.isEmpty) {
      await prefs.remove(_key);
      return;
    }
    final encoded = jsonEncode({
      for (final entry in all.entries)
        entry.key: {
          'answers': entry.value.answers,
          'answeredAtMs': entry.value.answeredAtMs,
        },
    });
    await prefs.setString(_key, encoded);
  }
}
