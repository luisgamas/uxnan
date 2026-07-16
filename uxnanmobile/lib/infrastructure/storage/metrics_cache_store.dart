import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';

/// Persists the last [MetricsSnapshot] the bridge reported for each PC
/// (`deviceId → snapshot`), so the all-PCs profile can render a PC's real
/// numbers even when only one PC is connected — and instantly on open.
///
/// This is a **display cache**, not the source of truth: it is wiped on an app
/// uninstall like all on-device data. The durable copy lives on each bridge and
/// is re-fetched via `metrics/get` on the next connection.
class MetricsCacheStore {
  /// Creates a store; inject a [SharedPreferences] future for tests.
  MetricsCacheStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _key = 'uxnan.metrics.snapshots';

  /// All cached snapshots, keyed by `deviceId`. Empty when nothing is cached.
  Future<Map<String, MetricsSnapshot>> readAll() async {
    final prefs = await _prefs;
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return {};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return {};
      final out = <String, MetricsSnapshot>{};
      decoded.forEach((key, value) {
        if (key is String && value is Map) {
          out[key] = MetricsSnapshot.fromJson(value.cast<String, dynamic>());
        }
      });
      return out;
    } on Object {
      return {};
    }
  }

  /// Stores (or replaces) one PC's snapshot, keyed by its `deviceId`.
  Future<void> writeOne(MetricsSnapshot snapshot) async {
    final all = await readAll();
    all[snapshot.deviceId] = snapshot;
    await _writeAll(all);
  }

  Future<void> _writeAll(Map<String, MetricsSnapshot> all) async {
    final prefs = await _prefs;
    final map = {
      for (final entry in all.entries) entry.key: entry.value.toJson(),
    };
    await prefs.setString(_key, jsonEncode(map));
  }
}
