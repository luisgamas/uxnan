import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/usage_summary.dart';

/// Keeps the last [UsageSummary] each PC answered (`macDeviceId → summary`),
/// so the all-PCs spend adds a PC that is not connected right now, and shows
/// instantly on open.
///
/// A **display cache**, not the source of truth: each PC's bridge reads its
/// agents' history again on the next connection (`usage/summary`).
class UsageSummaryCacheStore {
  /// Creates a store; inject a [SharedPreferences] future for tests.
  UsageSummaryCacheStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _key = 'uxnan.usage.summaries';

  /// Every cached summary, keyed by PC. Empty when nothing is cached or the
  /// stored value does not parse.
  Future<Map<String, UsageSummary>> readAll() async {
    final raw = (await _prefs).getString(_key);
    if (raw == null || raw.isEmpty) return {};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return {};
      return {
        for (final entry in decoded.entries)
          if (entry.key is String && entry.value is Map)
            entry.key as String: UsageSummary.fromJson(
              (entry.value as Map).cast<String, dynamic>(),
            ),
      };
    } on Object {
      return {};
    }
  }

  /// Stores (or replaces) one PC's summary.
  Future<void> writeOne(String deviceId, UsageSummary summary) async {
    final all = await readAll();
    all[deviceId] = summary;
    await (await _prefs).setString(
      _key,
      jsonEncode({for (final e in all.entries) e.key: e.value.toJson()}),
    );
  }
}
