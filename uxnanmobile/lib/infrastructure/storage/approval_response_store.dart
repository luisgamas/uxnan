import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// On-device store for the user's decisions on agent approval prompts.
///
/// Every time the user approves / rejects / "allow for this session" an
/// approval card, the decision is persisted here (along with the `approvalId`
/// the bridge assigned). The next time the same card scrolls into view — even
/// after an app restart — the card renders its **resolved** state and the
/// action buttons stay gone, so an answered prompt is never re-answered.
///
/// The store is intentionally non-sensitive (decisions are just
/// `approve`/`reject`/`approveSession`) and small (one entry per answered
/// card), so SharedPreferences is a clean fit and no SQLite migration is
/// needed.
///
/// Key: `uxnan.approval.responses` → a JSON map of
/// `{ approvalId: { decision, decidedAtMs } }`.
class ApprovalResponseStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  ApprovalResponseStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _key = 'uxnan.approval.responses';

  /// The persisted decision for [approvalId], or null when the user has not
  /// answered it on this device yet. Resolves to `null` on the first read
  /// (the key is absent) and on any decode error (we treat a corrupt blob as
  /// "no history" rather than crashing the card).
  Future<({String decision, int decidedAtMs})?> read(String approvalId) async {
    final all = await readAll();
    return all[approvalId];
  }

  /// All persisted decisions, keyed by `approvalId`. Used by the provider to
  /// hydrate its in-memory map at startup. Always returns a fresh, mutable
  /// map so callers can `addAll`/`remove` without crashing on a shared
  /// unmodifiable view.
  Future<Map<String, ({String decision, int decidedAtMs})>> readAll() async {
    final prefs = await _prefs;
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) {
      return <String, ({String decision, int decidedAtMs})>{};
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        return <String, ({String decision, int decidedAtMs})>{};
      }
      final out = <String, ({String decision, int decidedAtMs})>{};
      for (final entry in decoded.entries) {
        if (entry.key is! String) continue;
        final v = entry.value;
        if (v is! Map) continue;
        final decision = v['decision'];
        final decidedAtMs = v['decidedAtMs'];
        if (decision is! String || decidedAtMs is! int) continue;
        out[entry.key as String] = (
          decision: decision,
          decidedAtMs: decidedAtMs,
        );
      }
      return out;
    } on Object {
      return <String, ({String decision, int decidedAtMs})>{};
    }
  }

  /// Persists [decision] for [approvalId] with [decidedAtMs] (epoch ms). No-op
  /// when the same decision is already stored (idempotent on a repeated
  /// answer — protects against a double-tap or a re-render).
  Future<void> record({
    required String approvalId,
    required String decision,
    required int decidedAtMs,
  }) async {
    final all = await readAll();
    final existing = all[approvalId];
    if (existing != null && existing.decision == decision) return;
    all[approvalId] = (decision: decision, decidedAtMs: decidedAtMs);
    await _writeAll(all);
  }

  /// Removes the persisted decision for [approvalId] (used when a thread is
  /// deleted and its history is dropped — most callers just leave the entry).
  Future<void> forget(String approvalId) async {
    final all = await readAll();
    if (!all.containsKey(approvalId)) return;
    all.remove(approvalId);
    await _writeAll(all);
  }

  Future<void> _writeAll(
    Map<String, ({String decision, int decidedAtMs})> all,
  ) async {
    final prefs = await _prefs;
    if (all.isEmpty) {
      await prefs.remove(_key);
      return;
    }
    final encoded = jsonEncode({
      for (final entry in all.entries)
        entry.key: {
          'decision': entry.value.decision,
          'decidedAtMs': entry.value.decidedAtMs,
        },
    });
    await prefs.setString(_key, encoded);
  }
}
